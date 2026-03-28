// functions/api/detect.js
// Cloudflare Pages Functions

// 处理 OPTIONS 预检请求
export async function onRequestOptions() {
  return new Response('', {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// 处理 POST 请求
export async function onRequestPost(context) {
  const { request, env } = context;

  // 只允许 POST 请求
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    // 1. 获取上传的图片 Base64
    const { image } = await request.json();
    if (!image) {
      return new Response(JSON.stringify({ error: '缺少图片数据' }), { status: 400 });
    }

    // 去除 Base64 前缀（如果有）
    let base64Data = image;
    if (base64Data.includes(',')) {
      base64Data = base64Data.split(',')[1];
    }

    // 2. 从环境变量获取百度密钥
    const BAIDU_API_KEY = env.BAIDU_API_KEY;
    const BAIDU_SECRET_KEY = env.BAIDU_SECRET_KEY;
    if (!BAIDU_API_KEY || !BAIDU_SECRET_KEY) {
      return new Response(JSON.stringify({ error: '服务端配置错误' }), { status: 500 });
    }

    // 3. 获取百度 access_token
    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${BAIDU_API_KEY}&client_secret=${BAIDU_SECRET_KEY}`,
      { method: 'POST' }
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: '获取百度授权失败' }), { status: 500 });
    }

    // 4. 调用百度人脸检测接口
    const baiduRes = await fetch(
      `https://aip.baidubce.com/rest/2.0/face/v3/detect?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64Data,
          image_type: 'BASE64',
          max_face_num: 1,
          face_field: 'age,beauty,gender,face_shape,expression,emotion,glasses,landmark150'
        })
      }
    );

    const result = await baiduRes.json();
    
    // 百度返回错误时 result 中包含 error_code
    if (result.error_code) {
      return new Response(JSON.stringify({ error: `百度API错误: ${result.error_msg}` }), { status: 400 });
    }

    const faceList = result.result?.face_list;
    if (!faceList || faceList.length === 0) {
      return new Response(JSON.stringify({ error: '未检测到人脸，请确保照片清晰，正面' }), { status: 404 });
    }

    const face = faceList[0];

    // 评分改为80-100分
    const beautyScore = 80 + Math.round((face.beauty || 0) * 0.2);

    // 脸型中文映射
    const faceShapeMap = {
      'square': '国字脸',
      'triangle': '三角脸',
      'oval': '鹅蛋脸',
      'heart': '心形脸',
      'round': '圆脸'
    };
    const faceShapeCN = faceShapeMap[face.face_shape?.type] || '标准脸型';
    const genderCN = face.gender?.type === 'male' ? '男性' : '女性';

    // 计算面部比例
    let faceAnalysis = {};
    if (face.landmark150 && face.landmark150.length > 0) {
      faceAnalysis = calculateFaceProportions(face.landmark150, face.face_shape?.type);
    }

    // 简化版返回
    const responseData = {
      beauty: beautyScore,
      age: face.age,
      gender: face.gender?.type,
      gender_cn: genderCN,
      face_shape: face.face_shape?.type,
      face_shape_cn: faceShapeCN,
      expression: face.expression?.type,
      emotion: face.emotion?.type,
      glasses: face.glasses?.type,
      face_analysis: faceAnalysis,
      // landmark 数量调试
      landmark_count: face.landmark150 ? face.landmark150.length : 0
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    console.error('分析失败:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

// 计算面部比例数据
function calculateFaceProportions(landmarks, faceShape) {
  if (!landmarks || !Array.isArray(landmarks) || landmarks.length < 10) {
    return {
      three_quotients: { upper: 0, middle: 0, lower: 0, ratio: '0:0:0', assessment: '数据不足' },
      eye_distance: '-',
      mouth_width: '-'
    };
  }

  try {
    // 找关键点：根据百度landmark150的索引
    // 0-20: 眉毛, 21-52: 眼睛, 53-84: 鼻子, 85-134: 嘴巴, 135-149: 轮廓
    // 用y坐标找位置更可靠
    
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    let browPoints = [], eyePoints = [], nosePoints = [], mouthPoints = [], chinPoint = null;
    
    for (const p of landmarks) {
      if (!p || typeof p.x !== 'number') continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      
      const relY = (p.y - minY) / (maxY - minY || 1);
      
      if (relY < 0.25) browPoints.push(p);
      else if (relY < 0.5) eyePoints.push(p);
      else if (relY < 0.65) nosePoints.push(p);
      else if (relY < 0.85) mouthPoints.push(p);
      else chinPoint = p;
    }
    
    const faceWidth = maxX - minX;
    const faceHeight = maxY - minY;
    
    // 计算三庭
    const browY = browPoints.length > 0 ? (Math.min(...browPoints.map(p => p.y)) + Math.max(...browPoints.map(p => p.y))) / 2 : minY + faceHeight * 0.25;
    const noseY = nosePoints.length > 0 ? Math.max(...nosePoints.map(p => p.y)) : minY + faceHeight * 0.55;
    const chinY = chinPoint ? chinPoint.y : maxY;
    
    const upper = Math.round(browY - minY);
    const middle = Math.round(noseY - browY);
    const lower = Math.round(chinY - noseY);
    
    // 计算眼距
    let eyeLeft = eyePoints.filter(p => p.x < minX + faceWidth / 2);
    let eyeRight = eyePoints.filter(p => p.x >= minX + faceWidth / 2);
    let eyeDist = 0;
    if (eyeLeft.length > 0 && eyeRight.length > 0) {
      const leftInner = Math.max(...eyeLeft.map(p => p.x));
      const rightInner = Math.min(...eyeRight.map(p => p.x));
      eyeDist = Math.round(rightInner - leftInner);
    }
    
    // 计算嘴宽
    let mouthDist = 0;
    if (mouthPoints.length > 1) {
      const minMouthX = Math.min(...mouthPoints.map(p => p.x));
      const maxMouthX = Math.max(...mouthPoints.map(p => p.x));
      mouthDist = Math.round(maxMouthX - minMouthX);
    }
    
    // 评估
    const ratioUpper = middle > 0 ? upper / middle : 0;
    const ratioLower = middle > 0 ? lower / middle : 0;
    let ratioStr = `${ratioUpper.toFixed(2)}:1:${ratioLower.toFixed(2)}`;
    let ratioAssessment = '标准';
    if (Math.abs(ratioUpper - 0.86) < 0.15 && Math.abs(ratioLower - 1.06) < 0.15) {
      ratioAssessment = '标准三庭';
    } else if (ratioUpper > 1) {
      ratioAssessment = '上庭偏长';
    } else if (ratioUpper < 0.75) {
      ratioAssessment = '上庭偏短';
    } else if (ratioLower > 1.2) {
      ratioAssessment = '下庭偏长';
    } else if (ratioLower < 0.9) {
      ratioAssessment = '下庭偏短';
    }
    
    const eyeRatio = faceWidth > 0 ? eyeDist / faceWidth : 0;
    let eyeAssessment = '标准';
    if (eyeRatio > 0.32) eyeAssessment = '偏宽';
    else if (eyeRatio < 0.26) eyeAssessment = '偏窄';
    
    const mouthRatio = faceWidth > 0 ? mouthDist / faceWidth : 0;
    let mouthAssessment = '标准';
    if (mouthRatio > 0.4) mouthAssessment = '偏大';
    else if (mouthRatio < 0.32) mouthAssessment = '偏小';
    
    return {
      three_quotients: {
        upper: upper,
        middle: middle,
        lower: lower,
        ratio: ratioStr,
        assessment: ratioAssessment
      },
      eye_distance: `${eyeDist}px (占脸宽${Math.round(eyeRatio*100)}%)`,
      eye_assessment: eyeAssessment,
      mouth_width: `${mouthDist}px (占脸宽${Math.round(mouthRatio*100)}%)`,
      mouth_assessment: mouthAssessment,
      face_width: Math.round(faceWidth),
      face_height: Math.round(faceHeight)
    };
  } catch (e) {
    console.error('计算失败:', e);
    return {
      three_quotients: { upper: 0, middle: 0, lower: 0, ratio: '0:0:0', assessment: '计算错误' },
      eye_distance: '-',
      mouth_width: '-'
    };
  }
}

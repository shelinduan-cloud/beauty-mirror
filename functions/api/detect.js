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
    const landmarkKeys = face.landmark150 ? Object.keys(face.landmark150) : [];
    console.log('landmark150 keys count:', landmarkKeys.length);
    console.log('landmark150 sample keys:', landmarkKeys.slice(0, 10));
    
    if (landmarkKeys.length > 0) {
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
      // 调试信息
      landmark_count: landmarkKeys.length,
      landmark_sample: landmarkKeys.slice(0, 5)
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

// 计算面部比例数据（修正版，基于百度150点命名）
function calculateFaceProportions(landmark150, faceShape) {
  if (!landmark150 || typeof landmark150 !== 'object') {
    return {
      three_quotients: { upper: 0, middle: 0, lower: 0, ratio: '0:0:0', assessment: '数据不足' },
      eye_distance: '-',
      mouth_width: '-'
    };
  }

  try {
    // 调试：打印所有键名
    console.log('All landmark150 keys:', Object.keys(landmark150));

    // 辅助函数：安全获取点坐标
    const getPoint = (name) => {
      const p = landmark150[name];
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        return { x: p.x, y: p.y };
      }
      return null;
    };

    // 眼睛
    const leftEyeInner = getPoint('eye_left_right_corner');
    const leftEyeOuter = getPoint('eye_left_left_corner');
    const rightEyeInner = getPoint('eye_right_left_corner');
    const rightEyeOuter = getPoint('eye_right_right_corner');
    // 眉毛
    const leftEyebrow = getPoint('eyebrow_left_center');
    const rightEyebrow = getPoint('eyebrow_right_center');
    // 鼻子
    const noseTip = getPoint('nose_tip');
    // 嘴巴
    const mouthLeft = getPoint('mouth_left_corner');
    const mouthRight = getPoint('mouth_right_corner');
    // 下巴
    const chin = getPoint('chin');

    // 获取所有点的坐标用于计算边界
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const key in landmark150) {
      const p = landmark150[key];
      if (p && typeof p.y === 'number') {
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
      }
    }

    const faceWidth = maxX - minX;
    const faceHeight = maxY - minY;

    // 计算眉毛平均 y 值
    let browY = null;
    if (leftEyebrow && rightEyebrow) {
      browY = (leftEyebrow.y + rightEyebrow.y) / 2;
    } else if (leftEyebrow) {
      browY = leftEyebrow.y;
    } else if (rightEyebrow) {
      browY = rightEyebrow.y;
    }

    // 如果没有眉毛，用左眼上沿近似
    if (browY === null && leftEyeInner) {
      browY = leftEyeInner.y - 15;
    }

    // 三庭计算
    const foreheadY = browY !== null ? browY - (browY - minY) * 0.3 : minY;
    const noseY = noseTip ? noseTip.y : (browY !== null ? browY + (maxY - browY) * 0.4 : maxY * 0.6);
    const chinY = chin ? chin.y : maxY;

    const upper = Math.max(0, (browY !== null ? browY : foreheadY) - foreheadY);
    const middle = Math.max(0, noseY - (browY !== null ? browY : foreheadY));
    const lower = Math.max(0, chinY - noseY);

    // 眼距（内眼角距离）
    let eyeDist = 0;
    if (leftEyeInner && rightEyeInner) {
      eyeDist = Math.hypot(rightEyeInner.x - leftEyeInner.x, rightEyeInner.y - leftEyeInner.y);
    }

    // 嘴宽
    let mouthDist = 0;
    if (mouthLeft && mouthRight) {
      mouthDist = Math.abs(mouthRight.x - mouthLeft.x);
    }

    // 计算三庭比例字符串
    let ratioStr = `${upper.toFixed(2)}:${middle.toFixed(2)}:${lower.toFixed(2)}`;
    let ratioAssessment = '标准';
    if (upper > 0 && middle > 0 && lower > 0) {
      const upperRatio = upper / middle;
      const lowerRatio = lower / middle;
      if (Math.abs(upperRatio - 0.86) < 0.15 && Math.abs(lowerRatio - 1.06) < 0.15) {
        ratioAssessment = '标准三庭';
      } else if (upperRatio > 1.0) {
        ratioAssessment = '上庭偏长';
      } else if (upperRatio < 0.75) {
        ratioAssessment = '上庭偏短';
      } else if (lowerRatio > 1.2) {
        ratioAssessment = '下庭偏长';
      } else if (lowerRatio < 0.9) {
        ratioAssessment = '下庭偏短';
      }
    }

    // 眼距评估
    let eyeAssessment = '标准';
    if (faceWidth > 0 && eyeDist > 0) {
      const eyeRatio = eyeDist / faceWidth;
      if (eyeRatio > 0.32) eyeAssessment = '偏宽';
      else if (eyeRatio < 0.26) eyeAssessment = '偏窄';
    }

    // 嘴宽评估
    let mouthAssessment = '标准';
    if (faceWidth > 0 && mouthDist > 0) {
      const mouthRatio = mouthDist / faceWidth;
      if (mouthRatio > 0.4) mouthAssessment = '偏大';
      else if (mouthRatio < 0.32) mouthAssessment = '偏小';
    }

    return {
      three_quotients: {
        upper: 0,
        middle: 0,
        lower: 0,
        ratio: '标准',
        assessment: ratioAssessment
      },
      eye_distance: eyeDist > 0 ? Math.round(eyeDist) : 0,
      eye_distance_percent: faceWidth > 0 && eyeDist > 0 ? Math.round((eyeDist / faceWidth) * 100) : 0,
      eye_assessment: eyeAssessment,
      mouth_width: mouthDist > 0 ? Math.round(mouthDist) : 0,
      mouth_width_percent: faceWidth > 0 && mouthDist > 0 ? Math.round((mouthDist / faceWidth) * 100) : 0,
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

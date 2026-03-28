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
          face_field: 'age,beauty,gender,face_shape,expression,emotion,glasses,landmark'
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
      // landmark 数量调试
      landmark_count: face.landmark ? face.landmark.length : 0
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

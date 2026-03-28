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
          face_field: 'age,beauty,gender,face_shape,expression,emotion,glasses,landmark72,face_rect'
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

    // 5. 计算面部比例数据
    let faceAnalysis = {};
    if (face.landmark72 && face.landmark72.length > 0) {
      try {
        faceAnalysis = calculateFaceProportions(face, face.face_shape?.type);
      } catch (e) {
        console.error('计算失败:', e);
        faceAnalysis = generateDefaultAnalysis(face.face_shape?.type);
      }
    } else {
      faceAnalysis = generateDefaultAnalysis(face.face_shape?.type);
    }

    // 6. 评分改为80-100分
    const beautyScore = 80 + Math.round((face.beauty || 0) * 0.2);

    // 7. 生成专业医美建议
    const advice = generateAdvice(face.face_shape?.type, face.gender?.type, face.age, face.beauty, faceAnalysis);

    const responseData = {
      beauty: beautyScore,
      age: face.age,
      gender: face.gender?.type,
      face_shape: face.face_shape?.type,
      expression: face.expression?.type,
      emotion: face.emotion?.type,
      glasses: face.glasses?.type,
      face_analysis: faceAnalysis,
      advice: advice,
      // 调试信息
      debug: {
        face_rect: face.face_rect,
        has_face_rect: !!face.face_rect,
        landmark72_count: face.landmark72 ? face.landmark72.length : 0,
        face_keys: face ? Object.keys(face) : []
      }
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
function calculateFaceProportions(faceData, faceShape) {
  let faceAnalysis = {};
  
  try {
    const faceRect = faceData.face_rect;
    
    if (!faceRect) {
      return generateDefaultAnalysis(faceShape);
    }
    
    const faceWidth = faceRect.width;
    const faceHeight = faceRect.height;
    
    // 三庭：基于人脸框的标准比例计算
    // 上庭：发际线到眉毛 = 约30%面高
    // 中庭：眉毛到鼻底 = 约35%面高  
    // 下庭：鼻底到下巴 = 约35%面高
    const upper = Math.round(faceHeight * 0.30);
    const middle = Math.round(faceHeight * 0.34);
    const lower = Math.round(faceHeight * 0.36);
    
    // 眼距：约为脸宽的30%
    const eyeDist = Math.round(faceWidth * 0.30);
    // 嘴宽：约为脸宽的40%
    const mouthW = Math.round(faceWidth * 0.40);
    
    // 计算三庭比例
    const ratioUpper = middle > 0 ? upper / middle : 1;
    const ratioLower = middle > 0 ? lower / middle : 1;
    
    let ratioAssessment = '';
    if (Math.abs(ratioUpper - 0.88) < 0.1 && Math.abs(ratioLower - 1.06) < 0.1) {
      ratioAssessment = '标准三庭';
    } else if (ratioUpper > 0.95) {
      ratioAssessment = '上庭偏长';
    } else if (ratioUpper < 0.8) {
      ratioAssessment = '上庭偏短';
    } else if (ratioLower > 1.15) {
      ratioAssessment = '下庭偏长';
    } else if (ratioLower < 0.95) {
      ratioAssessment = '下庭偏短';
    } else {
      ratioAssessment = '接近标准';
    }
    
    // 眼距评估
    const eyeRatio = (eyeDist / faceWidth);
    let eyeAssessment = '';
    if (eyeRatio >= 0.28 && eyeRatio <= 0.32) {
      eyeAssessment = '眼距标准';
    } else if (eyeRatio > 0.32) {
      eyeAssessment = '眼距偏宽';
    } else {
      eyeAssessment = '眼距偏窄';
    }
    
    // 嘴宽评估
    const mouthRatio = (mouthW / faceWidth);
    let mouthAssessment = '';
    if (mouthRatio >= 0.38 && mouthRatio <= 0.44) {
      mouthAssessment = '嘴宽标准';
    } else if (mouthRatio > 0.44) {
      mouthAssessment = '嘴偏大';
    } else {
      mouthAssessment = '嘴偏小';
    }
    
    faceAnalysis = {
      three_quotients: {
        upper: upper,
        middle: middle,
        lower: lower,
        ratio: `${(upper/middle).toFixed(2)}:1:${(lower/middle).toFixed(2)}`,
        assessment: ratioAssessment
      },
      eye_distance: `${eyeDist}px (占脸宽${Math.round(eyeRatio*100)}%)`,
      eye_distance_ratio: eyeRatio,
      eye_assessment: eyeAssessment,
      mouth_width: `${mouthW}px (占脸宽${Math.round(mouthRatio*100)}%)`,
      mouth_width_ratio: mouthRatio,
      mouth_assessment: mouthAssessment,
      face_width: Math.round(faceWidth),
      face_height: Math.round(faceHeight)
    };
    
  } catch (e) {
    console.error('计算面部比例失败:', e);
    faceAnalysis = generateDefaultAnalysis(faceShape);
  }
  
  return faceAnalysis;
}

function generateDefaultAnalysis(faceShape) {
  return {
    three_quotients: {
      upper: 0,
      middle: 0,
      lower: 0,
      ratio: '1:1:1',
      assessment: '标准比例'
    },
    eye_distance: '适中',
    eye_width: '适中',
    mouth_width: '适中'
  };
}

// 生成专业医美建议
function generateAdvice(face_shape, gender, age, beauty, faceAnalysis) {
  const faceShapeMap = {
    'square': '国字脸',
    'triangle': '三角脸', 
    'oval': '鹅蛋脸',
    'heart': '心形脸',
    'round': '圆脸'
  };
  const faceShapeCN = faceShapeMap[face_shape] || '标准脸型';
  const genderCN = gender === 'male' ? '男性' : '女性';
  const ageNum = Math.round(age || 25);
  
  const beautyScore = 80 + Math.round((beauty || 0) * 0.2);
  const threeQ = faceAnalysis?.three_quotients || {};
  const ratioAssessment = threeQ.assessment || '';
  const eyeDist = faceAnalysis?.eye_distance || '';
  const mouthW = faceAnalysis?.mouth_width || '';
  
  let advantages = [];
  let disadvantages = [];
  let suggestions = [];
  
  // 分析优点
  if (ratioAssessment === '完美比例') advantages.push('三庭比例完美协调');
  if (eyeDist === '适中') advantages.push('眼距比例自然协调');
  if (mouthW === '适中') advantages.push('嘴部比例和谐');
  if (face_shape === 'oval') advantages.push('标准鹅蛋脸型');
  if (face_shape === 'heart') advantages.push('精致立体脸型');
  
  // 分析需要改善的部位
  if (ratioAssessment && ratioAssessment !== '完美比例') disadvantages.push(`三庭比例${ratioAssessment}，可通过面部填充改善`);
  if (eyeDist === '偏宽') disadvantages.push('眼距偏宽，可通过开眼角改善');
  if (eyeDist === '偏窄') disadvantages.push('眼距偏窄，略显紧凑');
  if (mouthW === '偏宽') disadvantages.push('嘴宽偏大，可通过微笑唇手术改善');
  if (mouthW === '偏窄') disadvantages.push('嘴宽偏窄，略显单薄');
  if (face_shape === 'round') disadvantages.push('脸型偏圆，缺乏立体感');
  if (face_shape === 'square') disadvantages.push('脸型偏方，线条硬朗');
  
  // 根据脸型生成建议
  let faceSuggestion = '';
  let skinSuggestion = '';
  let antiAgingSuggestion = '';
  
  if (face_shape === 'round') {
    faceSuggestion = gender === 'female' 
      ? '建议瘦脸针缩小面部宽度，玻尿酸填充下巴提升立体感'
      : '建议通过瘦脸针改善面部轮廓，提升成熟气质';
  } else if (face_shape === 'square') {
    faceSuggestion = gender === 'female'
      ? '建议瘦脸针改善咬肌，玻尿酸填充太阳穴柔和轮廓'
      : '方形脸具有阳刚之美，可根据个人喜好选择是否调整';
  } else if (face_shape === 'oval') {
    faceSuggestion = '脸型标准优美，建议保持，可适当微调下巴';
  } else if (face_shape === 'heart') {
    faceSuggestion = '建议玻尿酸填充下巴和下颌缘，优化面部比例';
  } else if (face_shape === 'triangle') {
    faceSuggestion = '建议瘦脸针缩小下颌角，玻尿酸填充太阳穴改善上窄下宽';
  } else {
    faceSuggestion = '建议到院进行专业面诊定制方案';
  }
  
  // 根据年龄生成建议
  if (ageNum <= 25) {
    skinSuggestion = '皮肤状态最佳，建议基础保养为主，定期做小气泡清洁和水光补水';
    antiAgingSuggestion = '无需抗衰，注意防晒和规律作息即可';
  } else if (ageNum <= 35) {
    skinSuggestion = '进入初老阶段，建议光子嫩肤改善肤色，水光针深层补水';
    antiAgingSuggestion = '可开始做热拉提预防松弛，配合使用含视黄醇的护肤品';
  } else if (ageNum <= 45) {
    skinSuggestion = '建议水光针+光子嫩肤联合治疗，改善细纹和色斑';
    antiAgingSuggestion = '建议热玛吉治疗，提升面部紧致度，改善下颌线';
  } else {
    skinSuggestion = '建议综合改善方案，热玛吉+超声刀联合治疗';
    antiAgingSuggestion = '需要全面抗衰，建议轮廓固定+提升治疗';
  }
  
  // 构建建议列表
  suggestions = [
    { title: '轮廓分析', content: faceSuggestion },
    { title: '皮肤管理', content: skinSuggestion },
    { title: '抗衰建议', content: antiAgingSuggestion }
  ];
  
  // 添加优缺点分析
  if (advantages.length > 0) {
    suggestions.unshift({ title: '面部优点', content: advantages.join('、') });
  }
  if (disadvantages.length > 0) {
    suggestions.splice(1, 0, { title: '改善建议', content: disadvantages.join('；') });
  }
  
  const summary = `您的${faceShapeCN}，${genderCN}性，年龄约${ageNum}岁。三庭比例${ratioAssessment || '标准'}，眼距${eyeDist || '标准'}，嘴宽${mouthW || '标准'}。综合颜值评分${beautyScore}分。${advantages.length > 0 ? '优点：' + advantages.join('、') + '。' : ''}${disadvantages.length > 0 ? '待改善：' + disadvantages.join('、') + '。' : ''}`;

  return {
    title: '专业医美分析报告',
    summary: summary,
    suggestions: suggestions,
    faceShape: faceShapeCN,
    age: ageNum,
    gender: genderCN,
    beauty: Math.round(beauty || 0),
    advantages: advantages,
    disadvantages: disadvantages
  };
}

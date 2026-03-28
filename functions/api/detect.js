// functions/api/detect.js
// Cloudflare Pages Functions

export default async function onRequest(context) {
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
          face_field: 'age,beauty,gender,face_shape,expression,emotion'
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

    // 5. 生成医美建议
    const advice = generateAdvice(face.face_shape?.type, face.gender?.type, face.age, face.beauty);

    const responseData = {
      beauty: face.beauty,
      age: face.age,
      gender: face.gender?.type,
      face_shape: face.face_shape?.type,
      expression: face.expression?.type,
      emotion: face.emotion?.type,
      advice: advice
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

// 生成医美建议函数
function generateAdvice(face_shape, gender, age, beauty) {
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
  
  let ageGroup = '';
  if (ageNum <= 25) ageGroup = '青年';
  else if (ageNum <= 35) ageGroup = '青壮年';
  else if (ageNum <= 45) ageGroup = '中年';
  else if (ageNum <= 55) ageGroup = '熟龄';
  else ageGroup = '中老年';

  const beautyScore = Math.min(100, Math.round((beauty || 0) * 1.5));
  const beautyLevel = beautyScore >= 85 ? '出众' : beautyScore >= 75 ? '优秀' : beautyScore >= 65 ? '良好' : beautyScore >= 55 ? '不错' : '需改善';
  
  let summary = '';
  let suggestions = [];

  if (face_shape === 'round') {
    summary = `您的脸型为圆形脸，年龄约${ageNum}岁，${genderCN}性。圆形脸型给人可爱、年轻的印象，但面部轮廓相对扁平，缺乏立体感。根据三庭五眼的美学标准，您的颜值评分高达${beautyScore}分，面部比例${beautyLevel}，展现独特魅力！`;
    
    if (gender === 'female') {
      if (ageNum <= 30) {
        suggestions = [
          { title: '面部轮廓', content: '建议通过注射瘦脸针缩小面部宽度，打造小脸效果。可配合玻尿酸填充下巴，提升面部立体感，使脸型更加精致。' },
          { title: '皮肤管理', content: `${ageNum}岁是皮肤状态最佳的时期，建议定期进行光子嫩肤、水光针等保养项目，维持皮肤弹性和水分，预防初老。` },
          { title: '日常护理', content: '建议使用含胶原蛋白、透明质酸的护肤品，注重防晒（SPF30+），保持规律作息，避免熬夜导致皮肤暗沉。' }
        ];
      } else if (ageNum <= 45) {
        suggestions = [
          { title: '面部轮廓', content: '建议通过瘦脸针改善面部轮廓，同时可考虑玻尿酸填充太阳穴和苹果肌，提升面部立体感。' },
          { title: '抗衰管理', content: `${ageNum}岁进入抗衰关键期，建议进行热玛吉或超声刀治疗，提升面部紧致度，改善轻度松弛和细纹。` },
          { title: '日常护理', content: '建议使用含视黄醇、肽类的抗衰护肤品，配合精华液和眼霜，重点关注眼周和嘴角的细微变化。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '建议通过玻尿酸填充提升面部轮廓，重点填充太阳穴、面颊和下巴，改善面部凹陷问题。' },
          { title: '抗衰管理', content: `${ageNum}岁需要综合抗衰方案，建议进行热玛吉+超声刀联合治疗，配合肉毒素除皱，全面提升面部紧致度。` },
          { title: '日常护理', content: '建议使用高端抗衰护肤品，含胶原蛋白、胜肽等成分，定期做面部按摩促进血液循环。' }
        ];
      }
    } else {
      if (ageNum <= 35) {
        suggestions = [
          { title: '面部轮廓', content: '圆形脸型显得年轻稚嫩，建议通过瘦脸针改善面部宽度，增加面部硬朗感，提升成熟气质。' },
          { title: '皮肤管理', content: '建议进行光子嫩肤改善肤色不均，注意日常防晒和清洁，预防痘痘和毛孔粗大问题。' },
          { title: '日常护理', content: '建议使用清爽控油护肤品，保持面部清洁，避免高糖高脂饮食，维持健康皮肤状态。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '建议通过玻尿酸填充太阳穴和下巴，提升面部立体感，使脸型更加硬朗有型。' },
          { title: '抗衰管理', content: `${ageNum}岁建议进行热玛吉治疗，提升面部紧致度，改善皮肤松弛下垂问题。` },
          { title: '日常护理', content: '建议使用抗衰护肤品，注意防晒和规律作息，适当运动促进皮肤新陈代谢。' }
        ];
      }
    }
  }
  else if (face_shape === 'square') {
    summary = `您的脸型为方形脸（国字脸），年龄约${ageNum}岁，${genderCN}性。方形脸型轮廓分明，给人刚毅、稳重的印象，非常有特色！您的颜值评分高达${beautyScore}分，展现独特魅力！根据美学标准，建议通过医美手段柔和面部线条，提升亲和力。`;
    
    if (gender === 'female') {
      if (ageNum <= 30) {
        suggestions = [
          { title: '面部轮廓', content: '建议通过注射瘦脸针改善咬肌肥大，缩小下颌角宽度。如需显著改善，可考虑轮廓手术或玻尿酸填充太阳穴。' },
          { title: '皮肤管理', content: '建议定期进行光子嫩肤、水光针等项目，改善皮肤质感，使面部更加柔和细腻。' },
          { title: '日常护理', content: '建议使用温和不刺激的护肤品，避免过度清洁导致皮肤屏障受损，可适当使用修护型精华。' }
        ];
      } else if (ageNum <= 45) {
        suggestions = [
          { title: '面部轮廓', content: '建议通过瘦脸针+玻尿酸填充综合改善，既能缩小咬肌，又能填充凹陷部位，使面部线条更加柔和。' },
          { title: '抗衰管理', content: `${ageNum}岁建议进行热玛吉治疗，提升面部紧致度，改善下颌线模糊问题。` },
          { title: '日常护理', content: '建议使用含视黄醇的抗衰精华，配合使用颈霜，关注下颌线和颈部的保养。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '建议通过玻尿酸填充太阳穴、面颊，改善面部凹陷，使面部比例更加协调。' },
          { title: '抗衰管理', content: `${ageNum}岁建议进行超声刀+热玛吉联合治疗，全面提升面部紧致度和轮廓线。` },
          { title: '日常护理', content: '建议使用高端抗衰护肤品，含胶原蛋白和肽类成分，定期做面部瑜伽提升面部线条。' }
        ];
      }
    } else {
      if (ageNum <= 35) {
        suggestions = [
          { title: '面部轮廓', content: '方形脸型具有阳刚之美，如希望柔和可注射瘦脸针改善下颌角宽度。无需过度调整，保持原有轮廓更具魅力。' },
          { title: '皮肤管理', content: '建议进行光子嫩肤改善肤色，注重日常清洁和防晒，保持健康清爽的面部状态。' },
          { title: '日常护理', content: '建议使用清爽型护肤品，保持面部清洁干燥，避免熬夜和辛辣饮食。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '方形脸型成熟稳重，如希望改善可考虑玻尿酸填充太阳穴，使面部比例更加协调。' },
          { title: '抗衰管理', content: `${ageNum}岁建议进行热玛吉或超声刀治疗，提升面部紧致度，改善下颌线松弛。` },
          { title: '日常护理', content: '建议使用抗衰护肤品，注意防晒和规律作息，适当运动维持年轻状态。' }
        ];
      }
    }
  }
  else if (face_shape === 'oval') {
    summary = `您的脸型为椭圆形脸（鹅蛋脸），年龄约${ageNum}岁，${genderCN}性。恭喜您！鹅蛋脸是东方美学中最理想的脸型之一，面部比例协调，线条流畅。根据分析，您的颜值评分高达${beautyScore}分，面部基础条件${beautyLevel}，建议重点放在维护和提升上。`;
    
    if (gender === 'female') {
      if (ageNum <= 30) {
        suggestions = [
          { title: '面部轮廓', content: '您的脸型已经非常理想，无需进行轮廓手术。建议通过轻微的玻尿酸填充下巴，使脸型更加精致立体。' },
          { title: '皮肤管理', content: `${ageNum}岁皮肤状态最佳，建议定期进行水光针、光子嫩肤等保养项目，维持皮肤弹性和光泽。` },
          { title: '日常护理', content: '建议使用含透明质酸、胶原蛋白的护肤品，注重防晒和卸妆，保持现有完美状态。' }
        ];
      } else if (ageNum <= 45) {
        suggestions = [
          { title: '面部轮廓', content: '脸型保持良好，可通过轻微的玻尿酸填充维持面部立体感，重点关注苹果肌和下巴。' },
          { title: '抗衰管理', content: `${ageNum}岁进入初老阶段，建议进行热玛吉或水光针治疗，预防细纹和皮肤松弛。` },
          { title: '日常护理', content: '建议使用抗初老护肤品，含视黄醇、肽类成分，配合使用眼霜和精华液。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '建议通过玻尿酸填充苹果肌和太阳穴，维持面部饱满度，保持年轻态。' },
          { title: '抗衰管理', content: `${ageNum}岁需要积极抗衰，建议进行热玛吉+超声刀联合治疗，配合肉毒素除皱。` },
          { title: '日常护理', content: '建议使用高端抗衰护肤品，定期做面部护理和按摩，促进护肤品吸收。' }
        ];
      }
    } else {
      if (ageNum <= 35) {
        suggestions = [
          { title: '面部轮廓', content: '鹅蛋脸型协调自然，保持即可。如想提升气质，可通过轻微的玻尿酸填充下巴。' },
          { title: '皮肤管理', content: '建议进行光子嫩肤改善肤色，注重日常清洁和防晒，保持健康形象。' },
          { title: '日常护理', content: '建议使用清爽型护肤品，保持面部清洁，避免熬夜和不良生活习惯。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '脸型保持良好，可通过玻尿酸填充太阳穴和下巴，提升面部立体感。' },
          { title: '抗衰管理', content: `${ageNum}岁建议进行热玛吉治疗，提升面部紧致度，预防衰老迹象。` },
          { title: '日常护理', content: '建议使用抗衰护肤品，注意防晒和规律作息，维持年轻状态。' }
        ];
      }
    }
  }
  else if (face_shape === 'heart') {
    summary = `您的脸型为心形脸（锥子脸），年龄约${ageNum}岁，${genderCN}性。心形脸型特点是额头宽、下巴尖，给人精致、时尚的印象。根据分析，您的颜值评分高达${beautyScore}分，面部基础条件${beautyLevel}，建议通过医美手段进一步优化面部比例。`;
    
    if (gender === 'female') {
      if (ageNum <= 35) {
        suggestions = [
          { title: '面部轮廓', content: '建议通过玻尿酸填充下巴和下颌缘，增强下巴立体感，使面部比例更加协调。避免过度填充导致脸型不自然。' },
          { title: '皮肤管理', content: '建议定期进行水光针、光子嫩肤等项目，维持皮肤弹性和光泽，打造精致面容。' },
          { title: '日常护理', content: '建议使用含透明质酸的护肤品，注重防晒和保湿，保持皮肤水润有光泽。' }
        ];
      } else {
        suggestions = [
          { title: '面部轮廓', content: '建议通过玻尿酸填充苹果肌和面颊，改善面部凹陷问题，使面部更加饱满年轻。' },
          { title: '抗衰管理', content: `${ageNum}岁建议进行热玛吉治疗，提升面部紧致度，预防苹果肌下垂。` },
          { title: '日常护理', content: '建议使用抗衰护肤品，含胶原蛋白和肽类成分，注意面部提升按摩。' }
        ];
      }
    } else {
      suggestions = [
        { title: '面部轮廓', content: '心形脸型已经比较精致，保持即可。如想改善可考虑玻尿酸填充下巴，增强面部立体感。' },
        { title: '皮肤管理', content: '建议进行光子嫩肤改善肤色，注重日常清洁和防晒。' },
        { title: '日常护理', content: '建议使用适合肤质的护肤品，保持健康生活方式。' }
      ];
    }
  }
  else if (face_shape === 'triangle') {
    summary = `您的脸型为三角形脸（梨形脸），年龄约${ageNum}岁，${genderCN}性。三角形脸型的特点是额头窄、下颌宽，给人稳重、亲和的印象，非常有特点！您的颜值评分高达${beautyScore}分，展现独特魅力！根据美学标准，建议通过医美手段改善面部比例，提升整体气质。`;
    
    suggestions = [
      { title: '面部轮廓', content: '建议通过瘦脸针缩小下颌角宽度，配合玻尿酸填充太阳穴，改善上窄下宽的面部比例。如想显著改善可考虑轮廓手术。' },
      { title: '皮肤管理', content: '建议定期进行光子嫩肤、水光针等项目，改善皮肤质感，使面部更加精致。' },
      { title: '日常护理', content: '建议使用修护型护肤品，注意面部清洁和保湿，避免下颌角部位的皮肤问题。' }
    ];
  }
  else {
    summary = `根据您的面部特征分析，年龄约${ageNum}岁，${genderCN}性。您的颜值评分高达${beautyScore}分，面部基础条件${beautyLevel}，建议通过专业面诊获取更精准的个性化方案。`;
    
    suggestions = [
      { title: '建议面诊', content: '建议到正规医美机构进行专业面诊，医生会根据您的三庭五眼比例和个人需求，制定个性化方案。' },
      { title: '基础保养', content: `${ageNum}岁建议注重日常护肤和定期医美保养，根据皮肤状态选择适合的项目。` },
      { title: '日常护理', content: '建议保持健康生活方式，规律作息、均衡饮食、适量运动，从内而外保持年轻态。' }
    ];
  }

  return {
    title: '个性化医美方案',
    summary: summary,
    suggestions: suggestions,
    faceShape: faceShapeCN,
    age: ageNum,
    gender: genderCN,
    beauty: Math.round(beauty || 0)
  };
}

// ================= Vercel Edge Function - 终极修复版 =================

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // 从环境变量读取订阅链接
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;

  if (!SUBSCRIPTION_URL) {
    return new Response("Error: 环境变量 SUBSCRIPTION_URL 未设置", { status: 500 });
  }

  // 1. 请求机场订阅
  const resp = await fetch(SUBSCRIPTION_URL, {
    headers: { "User-Agent": "ClashMeta/2.4.6", "Accept": "text/yaml, application/yaml" }
  });

  if (!resp.ok) return new Response("无法连接机场订阅，请检查 Vercel 环境变量设置", { status: 500 });

  let rawYaml = await resp.text();

  // 基础格式兼容处理
  if (!rawYaml.includes("proxies:") && !rawYaml.includes("proxy-groups:")) {
    try {
      const decoded = atob(rawYaml);
      if (decoded.includes("proxies:")) rawYaml = decoded;
    } catch (e) {
       return new Response("机场返回格式非 Clash YAML，请确认填入的是 Clash 订阅链接", { status: 400 });
    }
  }

  // 2. 提取所有节点名称 (增强过滤逻辑)
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire") && !n.includes("官网") && !n.includes("剩余")) {
      proxyNames.push(n);
    }
  }

  if (proxyNames.length === 0) return new Response("未找到有效节点，请检查节点名是否包含特殊字符", { status: 500 });

  // 3. 生成策略组 (增加引号包裹，防止 Emoji 报错)
  const groups = generateGroups(proxyNames);
  
  // 4. 生成分流规则 (优化顺序与格式)
  const rules = generateRules();

  // 5. 精确截断原配置文件
  let finalYaml = rawYaml;
  const groupIndex = finalYaml.indexOf("proxy-groups:");
  const rulesIndex = finalYaml.indexOf("rules:");
  
  // 截取到第一个出现的关键词为止
  const splitPoint = (groupIndex > 0 && (rulesIndex === -1 || groupIndex < rulesIndex)) ? groupIndex : rulesIndex;
  
  if (splitPoint > 0) {
    finalYaml = finalYaml.substring(0, splitPoint);
  }

  // 拼接新生成的配置
  finalYaml += "\n" + groups + "\n" + rules;

  return new Response(finalYaml, {
    headers: { "content-type": "text/yaml; charset=utf-8" }
  });
}

// --- 增强版策略组逻辑 (解决空组报错) ---
function generateGroups(allProxies) {
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States|America|🇺🇸/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain|Kingdom|🇬🇧/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore|🇸🇬/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai|🇹🇼/i },
    { name: "🇭🇰 香港·自动池", regex: /港|HK|Hong|🇭🇰/i },
    { name: "🇯🇵 日本·自动池", regex: /日|JP|Japan|🇯🇵/i }
  ];

  let groupYaml = "proxy-groups:\n";
  let autoGroupNames = [];

  // 1. 生成各地区自动池 (只有匹配到节点才创建，防止空组导致报错)
  regions.forEach(r => {
    const matched = allProxies.filter(n => r.regex.test(n));
    if (matched.length > 0) {
      autoGroupNames.push(r.name);
      groupYaml += `  - name: "${r.name}"\n`;
      groupYaml += `    type: url-test\n`;
      groupYaml += `    url: http://www.gstatic.com/generate_204\n`;
      groupYaml += `    interval: 300\n`;
      groupYaml += `    tolerance: 50\n`;
      groupYaml += `    proxies:\n`;
      matched.forEach(p => groupYaml += `      - "${p}"\n`);
    }
  });

  // 2. 生成智能容灾组
  const threeMajor = autoGroupNames.filter(n => n.includes("美国") || n.includes("新加坡") || n.includes("台湾"));
  let smartProxies = threeMajor.length > 0 ? threeMajor : autoGroupNames;
  // 兜底：如果都没有，就用所有节点
  if (smartProxies.length === 0) smartProxies = allProxies;
  
  groupYaml += `  - name: "⚡ 智能容灾·低延迟"\n`;
  groupYaml += `    type: url-test\n`;
  groupYaml += `    url: http://www.gstatic.com/generate_204\n`;
  groupYaml += `    interval: 300\n`;
  groupYaml += `    proxies:\n`;
  smartProxies.forEach(g => groupYaml += `      - "${g}"\n`);

  // 3. 定义通用选项
  const commonOptions = ["⚡ 智能容灾·低延迟", ...autoGroupNames, "DIRECT"];
  
  // 4. 应用分组 (APP 列表)
  const apps = [
    "🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", 
    "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🐭 Disney+", 
    "📲 Telegram", "🔎 Google", "🎮 Steam", "🛑 广告拦截", "🐟 漏网之鱼"
  ];

  apps.forEach(appName => {
    groupYaml += `  - name: "${appName}"\n`;
    groupYaml += `    type: select\n`;
    groupYaml += `    proxies:\n`;
    if (appName === "🛑 广告拦截") {
       groupYaml += `      - REJECT\n      - DIRECT\n`;
    } else {
       commonOptions.forEach(o => groupYaml += `      - "${o}"\n`);
    }
  });

  return groupYaml;
}

// --- 规则生成逻辑 (标准化格式) ---
function generateRules() {
  let ruleYaml = "rules:\n";
  const add = (ruleStr) => ruleYaml += `  - ${ruleStr}\n`;

  add("GEOSITE,category-ads-all,🛑 广告拦截");
  add("GEOSITE,openai,🤖 OpenAI");
  add("DOMAIN-SUFFIX,chatgpt.com,🤖 OpenAI");
  add("GEOSITE,anthropic,🔮 Claude");
  add("DOMAIN-SUFFIX,claude.ai,🔮 Claude");
  add("DOMAIN-SUFFIX,gemini.google.com,✨ Gemini");
  add("DOMAIN-KEYWORD,gemini,✨ Gemini");
  add("GEOSITE,twitter,✖️ X & Grok");
  add("DOMAIN-SUFFIX,grok.com,✖️ X & Grok");
  add("GEOSITE,category-finance,💰 金融支付");
  add("GEOSITE,crypto,💰 金融支付");
  add("DOMAIN-KEYWORD,bank,💰 金融支付");
  add("DOMAIN-SUFFIX,paypal.com,💰 金融支付");
  add("GEOSITE,youtube,📺 YouTube");
  add("GEOSITE,netflix,🎬 Netflix");
  add("GEOSITE,telegram,📲 Telegram");
  add("GEOIP,telegram,📲 Telegram");
  add("GEOSITE,google,🔎 Google");
  add("GEOSITE,cn,DIRECT");
  add("GEOIP,CN,DIRECT");
  add("MATCH,🐟 漏网之鱼");

  return ruleYaml;
}

// ================= Vercel Edge Function =================

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // 读取环境变量
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;

  if (!SUBSCRIPTION_URL) {
    return new Response("Error: 环境变量 SUBSCRIPTION_URL 未设置", { status: 500 });
  }

  // 1. 请求机场订阅
  const resp = await fetch(SUBSCRIPTION_URL, {
    headers: { "User-Agent": "ClashVerge/1.0", "Accept": "text/yaml, application/yaml" }
  });

  if (!resp.ok) return new Response("无法连接机场订阅", { status: 500 });

  let rawYaml = await resp.text();

  // 简单的 Base64 解码兼容 
  if (!rawYaml.includes("proxies:") && !rawYaml.includes("proxy-groups:")) {
    try {
      const decoded = atob(rawYaml);
      if (decoded.includes("proxies:")) rawYaml = decoded;
    } catch (e) {}
  }

  // 2. 提取所有节点名称
  const proxyNames = [];
  // 优化正则：排除流量、过期时间、官网、套餐信息
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    const name = match[1];
    if (!name.includes("Traffic") && !name.includes("Expire") && !name.includes("官网") && 
        !name.includes("剩余") && !name.includes("套餐") && !name.includes("重置")) {
      proxyNames.push(name.trim());
    }
  }

  if (proxyNames.length === 0) return new Response("未找到有效节点，请检查订阅链接是否正确", { status: 500 });

  // 3. 生成策略组
  const groups = generateGroups(proxyNames);
  
  // 4. 生成规则
  const rules = generateRules();

  // 5. 拼装
  let finalYaml = rawYaml;
  const groupIndex = finalYaml.indexOf("proxy-groups:");
  if (groupIndex > 0) finalYaml = finalYaml.substring(0, groupIndex);
  else {
    const rulesIndex = finalYaml.indexOf("rules:");
    if (rulesIndex > 0) finalYaml = finalYaml.substring(0, rulesIndex);
  }

  finalYaml += "\n" + groups + "\n" + rules;

  return new Response(finalYaml, {
    headers: { "content-type": "text/yaml; charset=utf-8" }
  });
}

// --- 策略组逻辑 ---
function generateGroups(allProxies) {
  // 1. 定义正则 (增加了 Emoji 和城市名，提高命中率)
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|USA|States|America|Los Angeles|San Jose|🇺🇸/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|GB|United Kingdom|Britain|London|🇬🇧/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore|🇸🇬/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai|🇹🇼/i },
    { name: "🇭🇰 香港·自动池", regex: /港|HK|Hong|🇭🇰/i },
    { name: "🇯🇵 日本·自动池", regex: /日|JP|Japan|Tokyo|🇯🇵/i }
  ];

  let groupYaml = "proxy-groups:\n";
  let autoGroupNames = [];

  // 生成自动池 (只有当匹配到节点时才创建，防止空组)
  regions.forEach(r => {
    const matched = allProxies.filter(n => r.regex.test(n));
    if (matched.length > 0) {
      autoGroupNames.push(r.name);
      groupYaml += `  - name: ${r.name}\n`;
      groupYaml += `    type: url-test\n`;
      groupYaml += `    url: http://www.gstatic.com/generate_204\n`;
      groupYaml += `    interval: 300\n`;
      groupYaml += `    tolerance: 50\n`;
      groupYaml += `    proxies:\n`;
      matched.forEach(p => groupYaml += `      - "${p}"\n`);
    }
  });

  // 2. 智能容灾 (核心修复点)
  const threeMajor = autoGroupNames.filter(n => n.includes("美国") || n.includes("新加坡") || n.includes("台湾"));
  
  // 【防崩溃逻辑】：如果美/新/台都没匹配到，就用所有自动组；如果自动组也没有，直接用所有节点！
  let smartProxies = threeMajor.length > 0 ? threeMajor : autoGroupNames;
  if (smartProxies.length === 0) {
    smartProxies = allProxies; // 终极兜底：直接塞所有节点，绝不报错
  }

  groupYaml += `  - name: ⚡ 智能容灾·低延迟\n`;
  groupYaml += `    type: url-test\n`;
  groupYaml += `    url: http://www.gstatic.com/generate_204\n`;
  groupYaml += `    interval: 300\n`;
  groupYaml += `    tolerance: 50\n`;
  groupYaml += `    proxies:\n`;
  smartProxies.forEach(g => {
    // 简单判断：如果是组名(在autoGroupNames里)就不加引号，是节点名就加引号
    if (autoGroupNames.includes(g)) groupYaml += `      - ${g}\n`;
    else groupYaml += `      - "${g}"\n`;
  });

  // 3. 通用选项
  const commonOptions = ["⚡ 智能容灾·低延迟", ...autoGroupNames, "DIRECT"];
  
  // 4. 应用分组
  const apps = [
    "🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", 
    "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🐭 Disney+", 
    "🎵 Spotify", "📲 Telegram", "🔎 Google", "🎮 Steam", 
    "🛑 广告拦截"
  ];

  apps.forEach(appName => {
    groupYaml += `  - name: ${appName}\n`;
    groupYaml += `    type: select\n`;
    groupYaml += `    proxies:\n`;
    if (appName === "🛑 广告拦截") {
       groupYaml += `      - REJECT\n      - DIRECT\n`;
    } else {
       commonOptions.forEach(o => groupYaml += `      - ${o}\n`);
    }
  });

  // 5. 漏网之鱼
  groupYaml += `  - name: 🐟 漏网之鱼\n`;
  groupYaml += `    type: select\n`;
  groupYaml += `    proxies:\n`;
  commonOptions.forEach(o => groupYaml += `      - ${o}\n`);

  return groupYaml;
}

// --- 规则逻辑 (包含所有你想要的风控) ---
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
  add("DOMAIN-SUFFIX,x.com,✖️ X & Grok");
  add("GEOSITE,category-finance,💰 金融支付");
  add("GEOSITE,crypto,💰 金融支付");
  add("DOMAIN-KEYWORD,bank,💰 金融支付");
  add("DOMAIN-SUFFIX,paypal.com,💰 金融支付");
  add("GEOSITE,youtube,📺 YouTube");
  add("GEOSITE,netflix,🎬 Netflix");
  add("GEOSITE,disney,🐭 Disney+");
  add("GEOSITE,spotify,🎵 Spotify");
  add("GEOSITE,telegram,📲 Telegram");
  add("GEOIP,telegram,📲 Telegram");
  add("GEOSITE,steam,🎮 Steam");
  add("GEOSITE,google,🔎 Google");
  add("GEOSITE,cn,DIRECT");
  add("GEOIP,CN,DIRECT");
  add("MATCH,🐟 漏网之鱼");

  return ruleYaml;
}

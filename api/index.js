// ================= Vercel Edge Function =================

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // 从环境变量读取订阅链接
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;

  if (!SUBSCRIPTION_URL) {
    return new Response(
      "配置错误：未找到环境变量 SUBSCRIPTION_URL。\n请到 Vercel 项目设置 -> Environment Variables 中添加。", 
      { status: 500 }
    );
  }

  // 1. 请求机场订阅
  const resp = await fetch(SUBSCRIPTION_URL, {
    headers: { 
      "User-Agent": "ClashVerge/1.0", 
      "Accept": "text/yaml, application/yaml" 
    }
  });

  if (!resp.ok) return new Response("无法连接机场订阅，请检查链接是否有效", { status: 500 });

  let rawYaml = await resp.text();

  // 格式检查与解码
  if (!rawYaml.includes("proxies:") && !rawYaml.includes("proxy-groups:")) {
    try {
      const decoded = atob(rawYaml);
      if (decoded.includes("proxies:")) rawYaml = decoded;
      else throw new Error("Not YAML");
    } catch (e) {
      return new Response("错误：机场返回的不是 Clash YAML 格式。", { status: 400 });
    }
  }

  // 2. 提取节点名称
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    const name = match[1];
    if (!name.includes("Traffic") && !name.includes("Expire") && !name.includes("官网") && !name.includes("剩余")) {
      proxyNames.push(name.trim());
    }
  }

  if (proxyNames.length === 0) return new Response("未找到有效节点", { status: 500 });

  // 3. 生成策略组
  const groups = generateGroups(proxyNames);
  
  // 4. 生成规则
  const rules = generateRules();

  // 5. 拼接最终配置
  let finalYaml = rawYaml;
  const groupIndex = finalYaml.indexOf("proxy-groups:");
  if (groupIndex > 0) finalYaml = finalYaml.substring(0, groupIndex);
  else {
    const rulesIndex = finalYaml.indexOf("rules:");
    if (rulesIndex > 0) finalYaml = finalYaml.substring(0, rulesIndex);
  }

  finalYaml += "\n" + groups + "\n" + rules;

  return new Response(finalYaml, {
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "subscription-userinfo": resp.headers.get("subscription-userinfo") || ""
    }
  });
}

// --- 策略组生成逻辑 ---
function generateGroups(allProxies) {
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States|America/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|United Kingdom|Britain/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i },
    { name: "🇭🇰 香港·自动池", regex: /港|HK|Hong/i },
    { name: "🇯🇵 日本·自动池", regex: /日|JP|Japan/i }
  ];

  let groupYaml = "proxy-groups:\n";
  let autoGroupNames = [];

  // 1. 生成各地区自动池
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

  // 2. 生成容灾
  const threeMajor = autoGroupNames.filter(n => n.includes("美国") || n.includes("新加坡") || n.includes("台湾"));
  const smartProxies = threeMajor.length > 0 ? threeMajor : autoGroupNames;
  
  groupYaml += `  - name: ⚡ 自动容灾\n`;
  groupYaml += `    type: url-test\n`;
  groupYaml += `    url: http://www.gstatic.com/generate_204\n`;
  groupYaml += `    interval: 300\n`;
  groupYaml += `    tolerance: 50\n`;
  groupYaml += `    proxies:\n`;
  smartProxies.forEach(g => groupYaml += `      - ${g}\n`);

  // 定义通用选项
  const commonOptions = ["⚡ 自动容灾", ...autoGroupNames, "DIRECT"];
  
  // 3. 定义应用分组
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

  // 4.漏网之鱼
  groupYaml += `  - name: 🐟 漏网之鱼\n`;
  groupYaml += `    type: select\n`;  // 手动选择模式
  groupYaml += `    proxies:\n`;
  // 默认给它智能容灾 + 所有国家池 + 直连
  commonOptions.forEach(o => groupYaml += `      - ${o}\n`);

  return groupYaml;
}

// --- 规则生成逻辑 ---
function generateRules() {
  let ruleYaml = "rules:\n";
  const add = (ruleStr) => ruleYaml += `  - ${ruleStr}\n`;

  add("GEOSITE,category-ads-all,🛑 广告拦截");
  
  // AI
  add("GEOSITE,openai,🤖 OpenAI");
  add("DOMAIN-SUFFIX,chatgpt.com,🤖 OpenAI");
  add("GEOSITE,anthropic,🔮 Claude");
  add("DOMAIN-SUFFIX,claude.ai,🔮 Claude");
  add("DOMAIN-SUFFIX,gemini.google.com,✨ Gemini");
  add("DOMAIN-KEYWORD,gemini,✨ Gemini");
  add("GEOSITE,twitter,✖️ X & Grok");
  add("DOMAIN-SUFFIX,grok.com,✖️ X & Grok");
  add("DOMAIN-SUFFIX,x.com,✖️ X & Grok");

  // 金融
  add("GEOSITE,category-finance,💰 金融支付");
  add("GEOSITE,crypto,💰 金融支付");
  add("DOMAIN-KEYWORD,bank,💰 金融支付");
  add("DOMAIN-KEYWORD,pay,💰 金融支付");
  add("DOMAIN-SUFFIX,paypal.com,💰 金融支付");
  add("DOMAIN-SUFFIX,stripe.com,💰 金融支付");
  add("DOMAIN-SUFFIX,wise.com,💰 金融支付");
  add("DOMAIN-SUFFIX,binance.com,💰 金融支付");

  // 常用
  add("GEOSITE,youtube,📺 YouTube");
  add("GEOSITE,netflix,🎬 Netflix");
  add("GEOSITE,disney,🐭 Disney+");
  add("GEOSITE,spotify,🎵 Spotify");
  add("GEOSITE,telegram,📲 Telegram");
  add("GEOIP,telegram,📲 Telegram");
  add("GEOSITE,steam,🎮 Steam");
  add("GEOSITE,google,🔎 Google");

  // 直连
  add("GEOSITE,cn,DIRECT");
  add("GEOSITE,china,DIRECT");
  add("GEOSITE,category-companies-cn,DIRECT");
  add("GEOIP,CN,DIRECT");
  
  // 5. 兜底规则
  add("MATCH,🐟 漏网之鱼");

  return ruleYaml;
}

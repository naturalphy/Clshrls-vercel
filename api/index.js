// ================= 用户配置区域 =================

// 【重要】这里必须填机场提供的 "Clash" 或 "Clash Meta" 专用订阅链接！
const SUBSCRIPTION_URL = "https://cdn.zenithgrid.co/?L2Rvd25sb2FkQ29uZmlnL0NsYXNoLmFzcHg/dD10cm9qYW4mZXE9d2luZG93cyZ1cms9ZDRjMmZiNmItYTQ3MC00MzM0LTg3NDgtNGRhMmQ5OWU1MzU3Jm1tPTEzMDE2OSZrdG1tPXp4SCUyZjdpSm9oWFJ2cENrSjFqZU1ndyUzZCUzZCY=";

// ================= Vercel 适配区域 =================

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // 1. 直接请求机场，获取原始 Clash 配置
  const resp = await fetch(SUBSCRIPTION_URL, {
    headers: { 
      "User-Agent": "ClashVerge/1.0", // 伪装成 Clash 客户端
      "Accept": "text/yaml, application/yaml" 
    }
  });

  if (!resp.ok) return new Response("无法连接机场订阅，请检查链接是否有效", { status: 500 });

  let rawYaml = await resp.text();

  // 安全检查：如果机场返回的不是 YAML 格式（比如是 Base64 乱码），说明你填错链接了
  if (!rawYaml.includes("proxies:") && !rawYaml.includes("proxy-groups:")) {
    // 尝试简单的 Base64 解码，万一机场没直接返回 YAML
    try {
      const decoded = atob(rawYaml);
      if (decoded.includes("proxies:")) {
        rawYaml = decoded;
      } else {
        throw new Error("Not YAML");
      }
    } catch (e) {
      return new Response(
        "错误：机场返回的不是 Clash YAML 格式。\n请去机场官网复制 'Clash 订阅链接' 填入代码。", 
        { status: 400 }
      );
    }
  }

  // 2. 提取所有节点名称
  const proxyNames = [];
  // 使用正则提取 proxies 列表中的 name 字段
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    // 排除无效节点（流量显示、过期时间、官网广告等）
    const name = match[1];
    if (!name.includes("Traffic") && !name.includes("Expire") && !name.includes("官网") && !name.includes("剩余")) {
      proxyNames.push(name.trim());
    }
  }

  if (proxyNames.length === 0) {
    return new Response("未找到有效节点，请检查订阅链接", { status: 500 });
  }

  // 3. 生成你要的“完美策略组”
  const groups = generateGroups(proxyNames);
  
  // 4. 生成你要的“完美分流规则”
  const rules = generateRules();

  // 5. 手术缝合：替换原配置中的策略组和规则
  let finalYaml = rawYaml;

  // 移除原有的 proxy-groups
  const groupIndex = finalYaml.indexOf("proxy-groups:");
  if (groupIndex > 0) {
    finalYaml = finalYaml.substring(0, groupIndex);
  } else {
    // 如果找不到 proxy-groups，可能是在 rules 之后（少见），尝试截断到 rules
    const rulesIndex = finalYaml.indexOf("rules:");
    if (rulesIndex > 0) finalYaml = finalYaml.substring(0, rulesIndex);
  }

  // 拼接新内容
  finalYaml += "\n" + groups + "\n" + rules;

  return new Response(finalYaml, {
    headers: {
      "content-type": "text/yaml; charset=utf-8",
      "subscription-userinfo": resp.headers.get("subscription-userinfo") || ""
    }
  });
}

// --- 以下逻辑保持不变 (自动池 + 智能容灾 + 严格风控) ---

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

  const threeMajor = autoGroupNames.filter(n => n.includes("美国") || n.includes("新加坡") || n.includes("台湾"));
  const smartProxies = threeMajor.length > 0 ? threeMajor : autoGroupNames;
  
  groupYaml += `  - name: ⚡ 智能容灾·低延迟\n`;
  groupYaml += `    type: url-test\n`;
  groupYaml += `    url: http://www.gstatic.com/generate_204\n`;
  groupYaml += `    interval: 300\n`;
  groupYaml += `    tolerance: 50\n`;
  groupYaml += `    proxies:\n`;
  smartProxies.forEach(g => groupYaml += `      - ${g}\n`);

  const commonOptions = ["⚡ 智能容灾·低延迟", ...autoGroupNames, "DIRECT"];
  
  const apps = [
    "🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", 
    "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🐭 Disney+", 
    "🎵 Spotify", "📲 Telegram", "🔎 Google", "🎮 Steam", 
    "🛑 广告拦截", "🐟 漏网之鱼"
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

  return groupYaml;
}

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
  
  add("MATCH,🐟 漏网之鱼");

  return ruleYaml;
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 请设置 SUBSCRIPTION_URL", { status: 500 });
  
  const resp = await fetch(SUBSCRIPTION_URL, { headers: { "User-Agent": "ClashMeta" } });
  if (!resp.ok) return new Response("机场连接失败", { status: 500 });
  
  const rawText = await resp.text();
  
  // 1. 找到 proxy-groups 的起始位置
  const proxyGroupsStart = rawText.search(/^proxy-groups:/m);
  
  // 2. 找到 rules 的起始位置
  const rulesStart = rawText.search(/^rules:/m);
  
  // 3. 提取三个部分
  let baseConfig = "";
  let originalRulesContent = "";
  
  if (proxyGroupsStart !== -1 && rulesStart !== -1) {
    // 基础配置：从开头到 proxy-groups 之前
    baseConfig = rawText.substring(0, proxyGroupsStart).trim();
    
    // 原始规则内容：从 rules: 之后的内容（去掉 "rules:" 这一行）
    const rulesSection = rawText.substring(rulesStart);
    originalRulesContent = rulesSection.replace(/^rules:\s*\n/m, '');
  }
  
  // 4. 提取所有节点名称
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawText)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire")) proxyNames.push(n);
  }
  
  // 5. 构建策略组
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i }
  ];
  
  let groupYaml = "proxy-groups:\n";
  let createdGroups = [];
  
  regions.forEach(r => {
    const matched = proxyNames.filter(n => r.regex.test(n));
    const finalProxies = matched.length > 0 ? matched : proxyNames;
    createdGroups.push(r.name);
    groupYaml += `  - {name: "${r.name}", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, proxies: [${finalProxies.map(p => `"${p}"`).join(",")}]}\n`;
  });
  
  const common = ["⚡ 智能容灾", ...createdGroups, "DIRECT"];
  groupYaml += `  - {name: "⚡ 智能容灾", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, proxies: ["🇺🇸 美国·自动池", "🇸🇬 新加坡·自动池", "🇹🇼 台湾·自动池"]}\n`;
  
  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - {name: "${app}", type: select, proxies: [${common.map(o => `"${o}"`).join(",")}]}\n`;
  });
  
  // 6. 构建自定义规则
  const customRules = `  - GEOSITE,openai,"🤖 OpenAI"
  - GEOSITE,anthropic,"🔮 Claude"
  - DOMAIN-SUFFIX,claude.ai,"🔮 Claude"
  - DOMAIN-KEYWORD,gemini,"✨ Gemini"
  - GEOSITE,twitter,"✖️ X & Grok"
  - GEOSITE,category-finance,"💰 金融支付"
  - GEOSITE,youtube,"📺 YouTube"
  - GEOSITE,netflix,"🎬 Netflix"
  - GEOSITE,google,"🔎 Google"`;
  
  // 7. 组装最终 YAML（只有一个 rules:）
  const finalYaml = `${baseConfig}

${groupYaml}
rules:
${customRules}
${originalRulesContent}`;
  
  return new Response(finalYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 环境变量 SUBSCRIPTION_URL 未设置", { status: 500 });

  const resp = await fetch(SUBSCRIPTION_URL, { headers: { "User-Agent": "ClashMeta" } });
  if (!resp.ok) return new Response("无法获取机场数据", { status: 500 });
  const rawYaml = await resp.text();

  // 1. 无损提取头部 
  const headerPart = rawYaml.split(/proxy-groups:/i)[0].trim();

  // 2. 提取所有节点名称
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(headerPart)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire")) proxyNames.push(n);
  }

  if (proxyNames.length === 0) return new Response("非法 YAML：未在机场配置中找到节点 proxies", { status: 500 });

  // 3. 定义保活自动池
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i },
    { name: "🇭🇰 香港·自动池", regex: /港|HK|Hong/i }
  ];

  let groupYaml = "proxy-groups:\n";
  let createdGroups = [];
  regions.forEach(r => {
    const matched = proxyNames.filter(n => r.regex.test(n));
    const finalProxies = matched.length > 0 ? matched : proxyNames;
    createdGroups.push(r.name);
    groupYaml += `  - name: "${r.name}"\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    tolerance: 50\n    proxies:\n`;
    finalProxies.forEach(p => groupYaml += `      - "${p}"\n`);
  });

  // 4. 定义应用组
  const common = ["⚡ 智能容灾", ...createdGroups, "DIRECT"];
  groupYaml += `  - name: "⚡ 智能容灾"\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    proxies:\n`;
  createdGroups.forEach(g => groupYaml += `      - "${g}"\n`);

  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - name: "${app}"\n    type: select\n    proxies:\n`;
    common.forEach(o => groupYaml += `      - "${o}"\n`);
  });

  // 5. 规则合并 (新规则前置 + 机场原规则后置)
  const airportRulesMatch = rawYaml.match(/rules:[\s\S]*/);
  const originalRules = airportRulesMatch ? airportRulesMatch[0].replace("rules:", "").trim() : "";

  const customRules = `rules:
  - GEOSITE,category-ads-all,REJECT
  - GEOSITE,openai,"🤖 OpenAI"
  - GEOSITE,anthropic,"🔮 Claude"
  - DOMAIN-SUFFIX,claude.ai,"🔮 Claude"
  - DOMAIN-KEYWORD,gemini,"✨ Gemini"
  - GEOSITE,twitter,"✖️ X & Grok"
  - GEOSITE,category-finance,"💰 金融支付"
  - GEOSITE,crypto,"💰 金融支付"
  - DOMAIN-KEYWORD,bank,"💰 金融支付"
  - GEOSITE,youtube,"📺 YouTube"
  - GEOSITE,netflix,"🎬 Netflix"
  - GEOSITE,google,"🔎 Google"
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT`;

  const finalYaml = `${headerPart}\n\n${groupYaml}\n\n${customRules}\n${originalRules}\n  - MATCH,"🐟 漏网之鱼"`;

  return new Response(finalYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

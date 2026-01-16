export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 环境变量未设置", { status: 500 });

  const resp = await fetch(SUBSCRIPTION_URL, { headers: { "User-Agent": "ClashMeta" } });
  if (!resp.ok) return new Response("机场连接失败", { status: 500 });
  const rawYaml = await resp.text();

  // --- 步骤 1: 提取原始头部 (含 DNS, Fake-IP, Proxies 节点定义) ---
  const headerParts = rawYaml.split(/proxy-groups:/i);
  const headerAndProxies = headerParts[0].trim();

  // --- 步骤 2: 提取节点名称 (用于自动池) ---
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(headerAndProxies)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire")) proxyNames.push(n);
  }

  // --- 步骤 3: 重新构建唯一的 proxy-groups ---
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

  const common = ["⚡ 智能容灾", ...createdGroups, "DIRECT"];
  groupYaml += `  - name: "⚡ 智能容灾"\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    proxies:\n`;
  createdGroups.forEach(g => groupYaml += `      - "${g}"\n`);

  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - name: "${app}"\n    type: select\n    proxies:\n`;
    common.forEach(o => groupYaml += `      - "${o}"\n`);
  });

  // --- 步骤 4: 重新构建唯一的 rules (彻底解决重复键名) ---
  const rulesParts = rawYaml.split(/rules:/i);
  const airportRules = rulesParts.length > 1 ? rulesParts[1].trim() : "";

  const customRules = `rules:
  - GEOSITE,category-ads-all,REJECT
  - GEOSITE,openai,"🤖 OpenAI"
  - GEOSITE,anthropic,"🔮 Claude"
  - DOMAIN-SUFFIX,claude.ai,"🔮 Claude"
  - DOMAIN-KEYWORD,gemini,"✨ Gemini"
  - GEOSITE,twitter,"✖️ X & Grok"
  - GEOSITE,category-finance,"💰 金融支付"
  - GEOSITE,crypto,"💰 金融支付"
  - GEOSITE,youtube,"📺 YouTube"
  - GEOSITE,netflix,"🎬 Netflix"
  - GEOSITE,google,"🔎 Google"
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT`;

  // --- 步骤 5: 终极拼装 ---
  const finalYaml = `${headerAndProxies}\n\n${groupYaml}\n\n${customRules}\n${airportRules}\n  - MATCH,"🐟 漏网之鱼"`;

  return new Response(finalYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

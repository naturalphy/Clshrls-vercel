export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Missing SUBSCRIPTION_URL", { status: 500 });

  const resp = await fetch(SUBSCRIPTION_URL, {
    headers: { "User-Agent": "ClashMeta/2.4.6" }
  });
  if (!resp.ok) return new Response("Airport Error", { status: 500 });

  let rawYaml = await resp.text();
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire") && !n.includes("官网")) proxyNames.push(n);
  }

  // --- 强制生成所有策略组，防止报错 ---
  const regionConfigs = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States|America/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain|Kingdom/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i },
    { name: "🇭🇰 香港·自动池", regex: /港|HK|Hong/i },
    { name: "🇯🇵 日本·自动池", regex: /日|JP|Japan/i }
  ];

  let groupYaml = "proxy-groups:\n";
  let createdGroups = [];

  regionConfigs.forEach(r => {
    const matched = proxyNames.filter(n => r.regex.test(n));
    // 即使没匹配到，也塞入所有节点，保证组不为空
    const proxies = matched.length > 0 ? matched : proxyNames; 
    createdGroups.push(r.name);
    groupYaml += `  - name: "${r.name}"\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    proxies:\n`;
    proxies.forEach(p => groupYaml += `      - "${p}"\n`);
  });

  const commonOptions = ["⚡ 智能容灾", ...createdGroups, "DIRECT"];
  groupYaml += `  - name: "⚡ 智能容灾"\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n    proxies:\n`;
  createdGroups.forEach(g => groupYaml += `      - "${g}"\n`);

  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - name: "${app}"\n    type: select\n    proxies:\n`;
    commonOptions.forEach(o => groupYaml += `      - "${o}"\n`);
  });

  // --- 规则部分 ---
  const rulesYaml = `rules:
  - GEOSITE,openai,"🤖 OpenAI"
  - GEOSITE,anthropic,"🔮 Claude"
  - DOMAIN-KEYWORD,gemini,"✨ Gemini"
  - GEOSITE,twitter,"✖️ X & Grok"
  - GEOSITE,category-finance,"💰 金融支付"
  - GEOSITE,youtube,"📺 YouTube"
  - GEOSITE,netflix,"🎬 Netflix"
  - GEOSITE,google,"🔎 Google"
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,"🐟 漏网之鱼"`;

  let finalYaml = rawYaml.substring(0, rawYaml.indexOf("proxy-groups:"));
  return new Response(finalYaml + "\n" + groupYaml + "\n" + rulesYaml, {
    headers: { "content-type": "text/yaml; charset=utf-8" }
  });
}

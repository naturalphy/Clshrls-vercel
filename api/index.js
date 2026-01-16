export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 环境变量未设置", { status: 500 });

  // 1. 借用转换后端拿到标准的节点 YAML (解决你说的“没有 proxies”问题)
  const backend = `https://api.acl4ssr.cn.com/sub?target=clash&insert=false&config=base&url=${encodeURIComponent(SUBSCRIPTION_URL)}`;
  const resp = await fetch(backend, { headers: { "User-Agent": "ClashMeta" } });
  
  if (!resp.ok) return new Response("转换后端连接失败", { status: 500 });
  let rawYaml = await resp.text();

  // 2. 提取节点名称
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    proxyNames.push(match[1].trim());
  }

  // 3. 构造你的专属策略组 (强制生成，防止 not found)
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
  groupYaml += `  - {name: "⚡ 智能容灾", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, proxies: [${createdGroups.map(g => `"${g}"`).join(",")}]}\n`;

  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - {name: "${app}", type: select, proxies: [${common.map(o => `"${o}"`).join(",")}]}\n`;
  });

  // 4. 定义规则
  const rulesYaml = `rules:
  - GEOSITE,openai,"🤖 OpenAI"
  - GEOSITE,anthropic,"🔮 Claude"
  - DOMAIN-KEYWORD,gemini,"✨ Gemini"
  - GEOSITE,twitter,"✖️ X & Grok"
  - GEOSITE,category-finance,"💰 金融支付"
  - GEOSITE,youtube,"📺 YouTube"
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,"🐟 漏网之鱼"`;

  const head = rawYaml.split("proxy-groups:")[0].trim();
  return new Response(head + "\n\n" + groupYaml + "\n" + rulesYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

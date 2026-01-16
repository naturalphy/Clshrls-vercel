export const config = { runtime: 'edge' };

export default async function handler(request) {
  // 从 Vercel 环境变量读取，安全第一
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 环境变量 SUBSCRIPTION_URL 未设置", { status: 500 });

  // 1. 获取基础配置
  const resp = await fetch(SUBSCRIPTION_URL, { headers: { "User-Agent": "ClashMeta/2.4.6" } });
  if (!resp.ok) return new Response("无法连接机场订阅", { status: 500 });

  let rawYaml = await resp.text();
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawYaml)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire")) proxyNames.push(n);
  }

  // 2. 强制生成所有策略组 (防止 Clash 报错 proxy not found)
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States|America/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain|Kingdom/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i },
    { name: "🇭🇰 香港·自动池", regex: /港|HK|Hong/i }
  ];

  let groupYaml = "proxy-groups:\n";
  let createdGroups = [];
  regions.forEach(r => {
    const matched = proxyNames.filter(n => r.regex.test(n));
    const proxies = matched.length > 0 ? matched : proxyNames; // 没匹配到就用全部节点兜底
    createdGroups.push(r.name);
    groupYaml += `  - {name: "${r.name}", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, proxies: [${proxies.map(p => `"${p}"`).join(",")}]}\n`;
  });

  // 智能容灾与功能分组
  const commonOptions = ["⚡ 智能容灾", ...createdGroups, "DIRECT"];
  groupYaml += `  - {name: "⚡ 智能容灾", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, proxies: [${createdGroups.map(g => `"${g}"`).join(",")}]}\n`;

  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - {name: "${app}", type: select, proxies: [${commonOptions.map(o => `"${o}"`).join(",")}]}\n`;
  });

  // 3. 增强规则：包含 Gemini, Claude, X/Grok, 金融支付及中国直连
  const rulesYaml = `rules:
  - GEOSITE,category-ads-all,REJECT
  - GEOSITE,openai,"🤖 OpenAI"
  - GEOSITE,anthropic,"🔮 Claude"
  - DOMAIN-KEYWORD,gemini,"✨ Gemini"
  - GEOSITE,twitter,"✖️ X & Grok"
  - GEOSITE,category-finance,"💰 金融支付"
  - GEOSITE,crypto,"💰 金融支付"
  - GEOSITE,youtube,"📺 YouTube"
  - GEOSITE,netflix,"🎬 Netflix"
  - GEOSITE,google,"🔎 Google"
  - GEOSITE,cn,DIRECT
  - GEOSITE,category-companies-cn,DIRECT
  - GEOIP,CN,DIRECT
  - MATCH,"🐟 漏网之鱼"`;

  const head = rawYaml.split("proxy-groups:")[0].trim();
  return new Response(head + "\n\n" + groupYaml + "\n" + rulesYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 请在 Vercel 设置 SUBSCRIPTION_URL", { status: 500 });

  const resp = await fetch(SUBSCRIPTION_URL, { headers: { "User-Agent": "ClashMeta" } });
  if (!resp.ok) return new Response("无法获取机场数据", { status: 500 });
  const rawYaml = await resp.text();

  // 1. 完整保留头部配置
  // 我们截取到第一个出现 proxies: 的位置，保留之前的所有内容
  const proxiesIndex = rawYaml.indexOf("proxies:");
  if (proxiesIndex === -1) return new Response("机场文件格式异常，未找到 proxies", { status: 400 });
  const headerAndProxies = rawYaml.split("proxy-groups:")[0].trim();

  // 2. 提取节点名称用于生成保活自动池
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(headerAndProxies)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire")) proxyNames.push(n);
  }

  // 3. 生成保活自动池
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
    groupYaml += `  - {name: "${r.name}", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, tolerance: 50, proxies: [${finalProxies.map(p => `"${p}"`).join(",")}]}\n`;
  });

  // 4. 应用分流组
  const common = ["⚡ 智能容灾", ...createdGroups, "DIRECT"];
  groupYaml += `  - {name: "⚡ 智能容灾", type: url-test, url: "http://www.gstatic.com/generate_204", interval: 300, proxies: ["🇺🇸 美国·自动池","🇸🇬 新加坡·自动池","🇹🇼 台湾·自动池"]}\n`;

  const apps = ["🤖 OpenAI", "🔮 Claude", "✨ Gemini", "✖️ X & Grok", "💰 金融支付", "📺 YouTube", "🎬 Netflix", "🔎 Google", "🐟 漏网之鱼"];
  apps.forEach(app => {
    groupYaml += `  - {name: "${app}", type: select, proxies: [${common.map(o => `"${o}"`).join(",")}]}\n`;
  });

  // 5. 规则合并：新规则前置 + 机场原规则后置
  const airportRulesMatch = rawYaml.match(/rules:[\s\S]*/);
  const originalRules = airportRulesMatch ? airportRulesMatch[0].replace("rules:", "").trim() : "";

  const customRules = `rules:
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

  const finalYaml = headerAndProxies + "\n\n" + groupYaml + "\n" + customRules + "\n" + originalRules + "\n  - MATCH,\"🐟 漏网之鱼\"";

  return new Response(finalYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

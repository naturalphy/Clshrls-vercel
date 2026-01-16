export const config = { runtime: 'edge' };

export default async function handler(request) {
  const SUBSCRIPTION_URL = process.env.SUBSCRIPTION_URL;
  if (!SUBSCRIPTION_URL) return new Response("Error: 请设置 SUBSCRIPTION_URL", { status: 500 });
  
  const resp = await fetch(SUBSCRIPTION_URL, { headers: { "User-Agent": "ClashMeta" } });
  if (!resp.ok) return new Response("机场连接失败", { status: 500 });
  
  const rawText = await resp.text();
  
  // 1. 找到 proxy-groups 和 rules 的位置
  const proxyGroupsStart = rawText.search(/^proxy-groups:/m);
  const rulesStart = rawText.search(/^rules:/m);
  
  // 2. 提取三个部分
  let baseConfig = "";
  let originalRules = "";
  
  if (proxyGroupsStart !== -1 && rulesStart !== -1) {
    // 基础配置：从开头到 proxy-groups 之前
    baseConfig = rawText.substring(0, proxyGroupsStart).trim();
    
    // 原始规则：从 rules: 开始到结尾（保留完整的 rules: 部分）
    originalRules = rawText.substring(rulesStart).trim();
  }
  
  // 3. 提取所有节点名称
  const proxyNames = [];
  const nameRegex = /^\s*-\s*\{?.*name:\s*["']?([^"'},]+)["']?/gm;
  let match;
  while ((match = nameRegex.exec(rawText)) !== null) {
    const n = match[1].trim();
    if (!n.includes("Traffic") && !n.includes("Expire")) proxyNames.push(n);
  }
  
  // 4. 构建地区自动池策略组
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i }
  ];
  
  let groupYaml = "proxy-groups:\n";
  
  regions.forEach(r => {
    const matched = proxyNames.filter(n => r.regex.test(n));
    const finalProxies = matched.length > 0 ? matched : proxyNames;
    groupYaml += `  - name: "${r.name}"\n    type: url-test\n    url: "http://www.gstatic.com/generate_204"\n    interval: 300\n    proxies:\n`;
    finalProxies.forEach(p => {
      groupYaml += `      - "${p}"\n`;
    });
  });
  
  // 5. 智能容灾组
  groupYaml += `  - name: "⚡ 智能容灾"\n    type: url-test\n    url: "http://www.gstatic.com/generate_204"\n    interval: 300\n    proxies:\n`;
  groupYaml += `      - "🇺🇸 美国·自动池"\n      - "🇸🇬 新加坡·自动池"\n      - "🇹🇼 台湾·自动池"\n`;
  
  // 6. 组装最终 YAML（保留原机场的完整规则）
  const finalYaml = `${baseConfig}

${groupYaml}

${originalRules}`;
  
  return new Response(finalYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

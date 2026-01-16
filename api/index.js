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
  let originalProxyGroups = "";
  let originalRules = "";
  
  if (proxyGroupsStart !== -1 && rulesStart !== -1) {
    baseConfig = rawText.substring(0, proxyGroupsStart).trim();
    const groupsSection = rawText.substring(proxyGroupsStart, rulesStart);
    originalProxyGroups = groupsSection.replace(/^proxy-groups:\s*\n/m, '').trim();
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
  
  // 4. 构建自定义地区自动池策略组
  const regions = [
    { name: "🇺🇸 美国·自动池", regex: /美|US|States/i },
    { name: "🇬🇧 英国·自动池", regex: /英|UK|Britain/i },
    { name: "🇸🇬 新加坡·自动池", regex: /新|SG|Singapore/i },
    { name: "🇹🇼 台湾·自动池", regex: /台|TW|Tai/i }
  ];
  
  let customGroups = "";
  
  regions.forEach(r => {
    const matched = proxyNames.filter(n => r.regex.test(n));
    const finalProxies = matched.length > 0 ? matched : proxyNames;
    customGroups += `  - name: "${r.name}"\n    type: url-test\n    url: "http://www.gstatic.com/generate_204"\n    interval: 300\n    proxies:\n`;
    finalProxies.forEach(p => {
      customGroups += `      - "${p}"\n`;
    });
  });
  
  // 5. 智能容灾组
  customGroups += `  - name: "⚡ 智能容灾"\n    type: url-test\n    url: "http://www.gstatic.com/generate_204"\n    interval: 300\n    proxies:\n`;
  customGroups += `      - "🇺🇸 美国·自动池"\n      - "🇸🇬 新加坡·自动池"\n      - "🇹🇼 台湾·自动池"\n`;
  
  // 6. 🔥 修改原规则中的策略组引用
  let modifiedRules = originalRules;
  const redirectMap = {
    'youtube': '⚡ 智能容灾',
    'googlevideo': '⚡ 智能容灾',
    'twitter': '⚡ 智能容灾',
    'x.com': '⚡ 智能容灾'
  };
  
  // 逐行处理规则
  const ruleLines = modifiedRules.split('\n');
  modifiedRules = ruleLines.map(line => {
    // 跳过非规则行
    if (!line.trim().startsWith('-')) return line;
    
    const lineLower = line.toLowerCase();
    
    // 检查是否匹配需要重定向的关键词
    for (const [keyword, targetGroup] of Object.entries(redirectMap)) {
      if (lineLower.includes(keyword)) {
        // 替换规则末尾的策略组
        // 支持格式：- DOMAIN-SUFFIX,youtube.com,原策略组
        const lastCommaIndex = line.lastIndexOf(',');
        if (lastCommaIndex !== -1) {
          return line.substring(0, lastCommaIndex + 1) + targetGroup;
        }
      }
    }
    
    return line;
  }).join('\n');
  
  // 7. 组装最终 YAML
  const finalYaml = `${baseConfig}

proxy-groups:
${customGroups}
${originalProxyGroups}

${modifiedRules}`;
  
  return new Response(finalYaml, {
    headers: { "Content-Type": "text/yaml; charset=utf-8" }
  });
}

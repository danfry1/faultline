// 1. JSON.parse can throw SyntaxError — no faultline factory
function parseConfig(raw: string) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

// 2. fetch can throw TypeError — no faultline factory
async function fetchJson(url: string) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return null;
  }
}

// 3. Mixed — third-party throw + caught with no narrowing
function mixed() {
  try {
    const a = JSON.parse('not json');
    return a;
  } catch (e) {
    throw e;
  }
}

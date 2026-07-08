const ANIMAL_WORDS = [
  "animal", "cat", "dog", "duck", "goose", "frog", "penguin", "seal", "bird",
  "bull", "bear", "fox", "rat", "mouse", "hamster", "rabbit", "bunny", "horse",
  "monkey", "ape", "panda", "lion", "tiger", "wolf", "fish", "shark"
];

const SPORTS_WORDS = ["world cup", "fifa", "football", "soccer", "nba", "nfl", "ufc"];
const AI_WORDS = ["ai", "grok", "openai", "chatgpt", "xai", "robot", "agent"];
const NEWS_WORDS = ["trump", "putin", "iran", "war", "police", "court", "ipo"];
const INFLUENCERS = new Map([
  ["ansem", "Ansem"],
  ["blknoiz06", "Ansem/blknoiz06"],
  ["elon", "Elon Musk"],
  ["musk", "Elon Musk"],
  ["sama", "Sam Altman"],
  ["altman", "Sam Altman"],
  ["toly", "Toly"],
  ["bonk", "BONK"],
  ["trump", "Donald Trump"]
]);

function clean(value) {
  return String(value || "").trim();
}

function textOf(coin) {
  return [
    coin.name,
    coin.symbol,
    coin.description,
    coin.twitter,
    coin.website
  ].map(clean).filter(Boolean).join(" ").toLowerCase();
}

function accountFromUrl(value) {
  const match = clean(value).match(/(?:x|twitter)\.com\/([^/?#]+)/i);
  if (!match) return null;
  const account = match[1];
  return ["i", "intent", "search", "share"].includes(account.toLowerCase()) ? null : account;
}

function isXUrl(value) {
  return /(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\//i.test(clean(value));
}

function includesAny(haystack, needles) {
  return needles.find((needle) => haystack.includes(needle)) || null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function confidence(base, evidence) {
  return Math.min(0.97, Number((base + evidence.length * 0.04).toFixed(2)));
}

function labelSource(account) {
  return account ? `@${account}` : "kaynak X postu";
}

export function summarizeOrigin(coin) {
  const name = clean(coin.name) || "Bu token";
  const symbol = clean(coin.symbol);
  const text = textOf(coin);
  const twitterAccount = accountFromUrl(coin.twitter);
  const websiteAccount = accountFromUrl(coin.website);
  const sourceAccount = twitterAccount || websiteAccount;
  const evidence = [];

  if (coin.twitter) evidence.push(`X linki: ${coin.twitter}`);
  if (coin.website) evidence.push(`Website: ${coin.website}`);
  if (symbol) evidence.push(`Symbol: ${symbol}`);
  if (name) evidence.push(`Token adi: ${name}`);
  if (twitterAccount) evidence.push(`X kaynak hesabi: @${twitterAccount}`);
  if (websiteAccount && websiteAccount !== twitterAccount) {
    evidence.push(`Website X hesabina gidiyor: @${websiteAccount}`);
  }

  const influencerKey = [...INFLUENCERS.keys()].find((key) => text.includes(key));
  if (twitterAccount?.toLowerCase() === "elonmusk" || text.includes("elonmusk")) {
    return {
      origin_type: "elon_post",
      origin_summary: `${name}, Elon Musk kaynakli bir X postu veya Elon etrafindaki bir anlatidan cikmis gorunuyor.`,
      origin_confidence: confidence(0.78, evidence),
      origin_evidence: unique([...evidence, "Elon/Musk sinyali bulundu"])
    };
  }

  if (twitterAccount?.toLowerCase() === "sama" || text.includes("sam altman") || text.includes("sama")) {
    return {
      origin_type: "sam_altman_post",
      origin_summary: `${name}, Sam Altman kaynakli bir X postu veya Sam Altman etrafindaki bir ifadeden cikmis gorunuyor.`,
      origin_confidence: confidence(0.76, evidence),
      origin_evidence: unique([...evidence, "Sam Altman/Sama sinyali bulundu"])
    };
  }

  if (influencerKey) {
    const person = INFLUENCERS.get(influencerKey);
    return {
      origin_type: "person_reference",
      origin_summary: `${name}, ${person} etrafindaki bir kisi/hesap anlatisi baz alinarak cikarilmis gorunuyor.`,
      origin_confidence: confidence(0.68, evidence),
      origin_evidence: unique([...evidence, `${person} sinyali bulundu`])
    };
  }

  const animal = includesAny(text, ANIMAL_WORDS);
  if (animal) {
    const source = labelSource(sourceAccount);
    return {
      origin_type: "animal_meme",
      origin_summary: `${name}, ${source} uzerindeki ${animal} temali bir hayvan meme/anlatimindan cikarilmis gorunuyor.`,
      origin_confidence: confidence(0.64, evidence),
      origin_evidence: unique([...evidence, `Hayvan sinyali: ${animal}`])
    };
  }

  const sports = includesAny(text, SPORTS_WORDS);
  if (sports) {
    return {
      origin_type: "sports_event",
      origin_summary: `${name}, ${sports} etrafindaki spor gundemi veya taraftar anlatisindan cikarilmis gorunuyor.`,
      origin_confidence: confidence(0.58, evidence),
      origin_evidence: unique([...evidence, `Spor sinyali: ${sports}`])
    };
  }

  const ai = includesAny(text, AI_WORDS);
  if (ai) {
    return {
      origin_type: "ai_grok",
      origin_summary: `${name}, AI/Grok/OpenAI etrafindaki bir teknoloji anlatisindan cikarilmis gorunuyor.`,
      origin_confidence: confidence(0.56, evidence),
      origin_evidence: unique([...evidence, `AI sinyali: ${ai}`])
    };
  }

  const news = includesAny(text, NEWS_WORDS);
  if (news) {
    return {
      origin_type: "news_event",
      origin_summary: `${name}, ${news} etrafindaki guncel haber/olay anlatisindan cikarilmis olabilir.`,
      origin_confidence: confidence(0.46, evidence),
      origin_evidence: unique([...evidence, `Haber sinyali: ${news}`])
    };
  }

  if (isXUrl(coin.twitter) || isXUrl(coin.website)) {
    return {
      origin_type: "x_post_reference",
      origin_summary: `${name}, bagli X postundan veya X hesabindan alinmis kisa bir ifade/karakter uzerine kurulmus gorunuyor.`,
      origin_confidence: confidence(0.42, evidence),
      origin_evidence: unique(evidence)
    };
  }

  return {
    origin_type: "unknown",
    origin_summary: `${name} icin cikis nedeni net degil; token metadata'sinda guclu bir X/haber/hayvan/kisi sinyali bulunamadi.`,
    origin_confidence: confidence(0.22, evidence),
    origin_evidence: unique(evidence)
  };
}

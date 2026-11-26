import assert from "node:assert/strict";
import { test } from "node:test";
import { identityKeyForUrl, normalizeUrl, tweetIdFromUrl } from "../packages/backend/src/lib/url.ts";

test("Maimai public share and community aliases keep one post identity without sharer tracking", () => {
  const url = 'https://maimai.cn/n/content/gossip-detail/100123?egid=public-post&gid=100123&operation_id=tracking&share_channel=5&share_euid=sharer';
  assert.equal(identityKeyForUrl(url),'maimai:post:100123');
  assert.equal(identityKeyForUrl('https://maimai.cn/community/gossip-detail/100123?egid=public-post'),'maimai:post:100123');
  assert(!normalizeUrl(url)!.includes('sharer'));
  assert(!normalizeUrl(url)!.includes('operation_id'));
  assert.notEqual(identityKeyForUrl(url),identityKeyForUrl('https://maimai.cn/community/gossip-detail/100124'));
  assert.notEqual(identityKeyForUrl(url),identityKeyForUrl('https://maimai.cn.example.org/community/gossip-detail/100123'));
});

test("36kr and Huxiu RSS attribution does not duplicate their web articles", () => {
  for (const url of ["https://36kr.com/p/4026486163984519", "https://www.huxiu.com/article/4897880.html"]) {
    assert.equal(identityKeyForUrl(`${url}?f=rss`), identityKeyForUrl(url));
    assert.notEqual(identityKeyForUrl(`${url}?f=other`), identityKeyForUrl(url));
  }
  assert.equal(normalizeUrl("https://example.org/post?f=rss"), "https://example.org/post?f=rss");
});

test("Jinli weekly paths keep the imported identity across the publisher's redirects", () => {
  const base = "https://jinliqiuzhi.com/weekly/2026w47/";
  for (const kind of ["campus", "intern"]) {
    assert.equal(identityKeyForUrl(base + `internet-${kind}.html`), `url:${base}internet_${kind}`);
  }
  assert.notEqual(identityKeyForUrl(base + "internet-campus.html"), identityKeyForUrl(base + "internet-intern.html"));
  assert.notEqual(identityKeyForUrl(base + "internet-campus.html"), identityKeyForUrl(base.replace("w47", "w46") + "internet-campus.html"));
});

test("X and Twitter status URL variants keep the same material identity", () => {
  for (const host of ["x.com", "twitter.com", "www.x.com", "www.twitter.com", "mobile.twitter.com", "m.twitter.com"]) {
    for (const path of ["/openai/status/1234567890", "/openai/statuses/1234567890", "/i/status/1234567890"]) {
      const url = `https://${host}${path}?s=20#thread`;
      assert.equal(tweetIdFromUrl(url), "1234567890", url);
      assert.equal(identityKeyForUrl(url), "x:1234567890", url);
    }
  }
  assert.equal(tweetIdFromUrl("http://TWITTER.COM/openai/status/1234567890/photo/1"), "1234567890");
});

test("other sites containing a tweet URL keep their own material identity", () => {
  const tweet = "https://x.com/openai/status/1234567890";
  const urls = [
    `https://news.example.org/article/42?related=${tweet}`,
    `https://news.example.org/article/42#${tweet}`,
    `https://news.example.org/archive/${tweet}`,
    "https://notx.com/openai/status/1234567890",
    "https://nottwitter.com/openai/status/1234567890",
    "https://x.com.example.org/openai/status/1234567890",
    "https://x.com@news.example.org/openai/status/1234567890",
  ];
  for (const url of urls) {
    assert.equal(tweetIdFromUrl(url), null, url);
    assert.equal(identityKeyForUrl(url), `url:${normalizeUrl(url)}`, url);
    assert.notEqual(identityKeyForUrl(url), identityKeyForUrl(tweet), url);
  }
});

test("only a complete status id at the expected path identifies a tweet", () => {
  for (const url of [
    "https://x.com/search?q=https://x.com/openai/status/1234567890",
    "https://x.com/archive/openai/status/1234567890",
    "https://x.com/openai/status/1234567890junk",
    "https://x.com/openai/status/",
    "https://x.com/openai/status/not-a-number",
  ]) assert.equal(tweetIdFromUrl(url), null, url);
});

test("invalid and non-HTTP URLs cannot acquire a tweet identity", () => {
  for (const url of ["not a URL", "x.com/openai/status/1234567890", "ftp://x.com/openai/status/1234567890"]) {
    assert.equal(tweetIdFromUrl(url), null, url);
    assert.equal(identityKeyForUrl(url), null, url);
  }
});

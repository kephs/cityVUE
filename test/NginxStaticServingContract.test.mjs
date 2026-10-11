import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../deploy/frontend/nginx/nginx.conf", import.meta.url),
  "utf8",
);

// Bounded directive/block parser. Source contracts are not NGINX execution.
function parse(text) {
  const tokens =
    text.replace(/#[^\n]*/g, "").match(/"(?:\\.|[^"])*"|[{};]|[^\s{};]+/g) ??
    [];
  let cursor = 0;
  function block(nested = false) {
    const nodes = [];
    while (cursor < tokens.length) {
      if (tokens[cursor] === "}") {
        assert.ok(nested);
        cursor++;
        return nodes;
      }
      const words = [];
      while (
        cursor < tokens.length &&
        !["{", "}", ";"].includes(tokens[cursor])
      ) {
        const token = tokens[cursor++];
        words.push(token.startsWith('"') ? JSON.parse(token) : token);
      }
      assert.ok(words.length);
      const end = tokens[cursor++];
      assert.ok(["{", ";"].includes(end), "unterminated directive");
      nodes.push({
        name: words[0],
        args: words.slice(1),
        children: end === "{" ? block(true) : null,
      });
    }
    assert.equal(nested, false, "unclosed block");
    return nodes;
  }
  return block();
}
const tree = parse(source);
const one = (nodes, name) => {
  const matches = nodes.filter((n) => n.name === name);
  assert.equal(matches.length, 1, name);
  return matches[0];
};
const http = one(tree, "http").children;
const server = one(http, "server").children;
const locations = server.filter((n) => n.name === "location");
const location = (key) => {
  const found = locations.filter((n) => n.args.join(" ") === key);
  assert.equal(found.length, 1, key);
  return found[0].children;
};
const directive = (nodes, name) => one(nodes, name).args;
const maps = http.filter((n) => n.name === "map");
const map = (name) =>
  one(
    maps.map((n) => ({ ...n, name: n.args[1] })),
    name,
  );
const entries = (node) =>
  Object.fromEntries(node.children.map((n) => [n.name, n.args.join(" ")]));
const all = (nodes) => nodes.flatMap((n) => [n, ...all(n.children ?? [])]);

test("local unprivileged listener and fixed static root", () => {
  assert.deepEqual(directive(server, "listen"), [
    "127.0.0.1:8080",
    "default_server",
  ]);
  assert.deepEqual(directive(server, "root"), ["/usr/share/nginx/html"]);
  assert.deepEqual(directive(server, "index"), ["index.html"]);
  assert.deepEqual(directive(server, "autoindex"), ["off"]);
});
test("bridge and index are exact files with missing-file failures", () => {
  for (const key of ["= /redirect.html", "= /index.html"]) {
    assert.deepEqual(directive(location(key), "try_files"), ["$uri", "=404"]);
    assert.equal(location(key).length, 1);
  }
});
test("assets have prefix precedence and no fallback", () => {
  assert.deepEqual(directive(location("^~ /assets/"), "try_files"), [
    "$uri",
    "=404",
  ]);
  assert.deepEqual(directive(location("= /assets"), "return"), ["404"]);
});
test("API root and descendants fail closed", () => {
  for (const key of ["= /api", "^~ /api/"]) {
    assert.deepEqual(location(key), [
      { name: "return", args: ["404"], children: null },
    ]);
  }
});
test("file-like missing paths including path-info cannot receive SPA fallback", () => {
  const regexes = locations.filter((n) => n.args[0] === "~");
  assert.equal(regexes.length, 1);
  const matcher = new RegExp(regexes[0].args[1]);
  for (const uri of [
    "/missing.js",
    "/missing.mjs",
    "/missing.css",
    "/favicon.ico",
    "/foo.png",
    "/font.woff2",
    "/app.js.map",
    "/redirect.html/extra",
    "/.env",
    "/x.y/child",
  ])
    assert.ok(matcher.test(uri), uri);
  for (const uri of [
    "/",
    "/staff",
    "/admin",
    "/map-preview",
    "/service-requests/123",
  ])
    assert.equal(matcher.test(uri), false, uri);
  assert.deepEqual(directive(regexes[0].children, "try_files"), [
    "$uri",
    "=404",
  ]);
});
test("only navigation can fall back to exact index", () => {
  assert.deepEqual(directive(location("/"), "try_files"), [
    "$uri",
    "/index.html",
  ]);
  assert.equal(
    all(tree).filter(
      (n) => n.name === "try_files" && n.args.includes("/index.html"),
    ).length,
    1,
  );
  assert.equal(
    all(tree).some((n) => n.name === "error_page"),
    false,
  );
  assert.equal(locations.length, 8);
});
test("COOP is same-origin with only the exact bridge omission", () => {
  assert.deepEqual(map("$frontend_coop").args, ["$uri", "$frontend_coop"]);
  assert.deepEqual(entries(map("$frontend_coop")), {
    default: "same-origin",
    "~^/redirect[.]html$": "",
  });
  const exception = new RegExp(map("$frontend_coop").children[1].name.slice(1));
  assert.ok(exception.test("/redirect.html"));
  for (const uri of [
    "/",
    "/index.html",
    "/REDIRECT.HTML",
    "/redirect.html/extra",
    "/auth/redirect.html",
  ]) {
    assert.equal(exception.test(uri), false, uri);
  }
});
test("every location inherits the full baseline without child header overrides", () => {
  const expected = {
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "$frontend_coop",
    "Cache-Control": "$frontend_cache",
  };
  const headers = all(tree).filter((n) => n.name === "add_header");
  assert.equal(headers.length, 5);
  assert.deepEqual(
    Object.fromEntries(headers.map((n) => [n.args[0], n.args[1]])),
    expected,
  );
  assert.ok(headers.every((n) => n.args[2] === "always"));
  assert.ok(
    locations.every(
      (n) => !all(n.children).some((d) => d.name === "add_header"),
    ),
  );
});
test("HTML no-store is distinct from successful static no-cache", () => {
  const policy = map("$frontend_cache_class");
  assert.deepEqual(policy.args, ["$uri", "$frontend_cache_class"]);
  assert.deepEqual(entries(policy), {
    default: "no-cache",
    "~*\\.html$": "no-store",
  });
  const html = new RegExp(
    policy.children.find((n) => n.name.startsWith("~*")).name.slice(2),
    "i",
  );
  for (const uri of ["/index.html", "/redirect.html"])
    assert.ok(html.test(uri));
  for (const uri of ["/assets/index-abcd.js", "/assets/main-abcd.css"])
    assert.equal(html.test(uri), false);
});
test("errors are no-store independent of asset class", () => {
  assert.deepEqual(map("$frontend_cache").args, ["$status", "$frontend_cache"]);
  assert.deepEqual(entries(map("$frontend_cache")), {
    default: "no-store",
    200: "$frontend_cache_class",
    206: "$frontend_cache_class",
    304: "$frontend_cache_class",
  });
});
test("standard MIME mapping plus explicit mjs extension is required", () => {
  assert.deepEqual(directive(http, "include"), ["/etc/nginx/mime.types"]);
  assert.deepEqual(one(http, "types").children, [
    { name: "application/javascript", args: ["mjs"], children: null },
  ]);
  assert.deepEqual(directive(http, "default_type"), [
    "application/octet-stream",
  ]);
  assert.equal(all(tree).filter((n) => n.name === "types").length, 1);
  // html/js/css mappings in the installed standard file require runtime validation.
});
test("no CSP HSTS numeric cache policy or API upstream introduced", () => {
  const directives = all(tree);
  for (const name of [
    "proxy_pass",
    "upstream",
    "expires",
    "add_header_inherit",
    "rewrite",
  ])
    assert.equal(
      directives.some((n) => n.name === name),
      false,
      name,
    );
  assert.doesNotMatch(
    directives.flatMap((n) => n.args).join(" "),
    /Content-Security-Policy|Strict-Transport-Security|max-age|s-maxage|immutable|stale-while-revalidate|same-origin-allow-popups/i,
  );
});
test("MSAL retains root callbacks and the independent bridge entry", () => {
  const auth = readFileSync(
    new URL("../react/src/auth/msalConfig.js", import.meta.url),
    "utf8",
  );
  for (const property of ["redirectUri", "postLogoutRedirectUri"])
    assert.ok(
      auth.includes(
        property +
          ": " +
          String.fromCharCode(96) +
          "$" +
          "{origin}/" +
          String.fromCharCode(96),
      ),
    );
  assert.doesNotMatch(auth, /redirect\.html/);
  const bridge = readFileSync(
    new URL("../react/redirect.html", import.meta.url),
    "utf8",
  );
  assert.match(bridge, /@azure\/msal-browser\/redirect-bridge/);
  assert.doesNotMatch(bridge, /src\/main|React|Router|fetch\(/);
});

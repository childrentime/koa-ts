import { IncomingMessage } from "http";
import parse from "parseurl";
import qs from "qs";
import url from "url";
import net from "net";
import accepts from "accepts";
import fresh from "fresh";
import contentType from "content-type";
import typeis from "type-is";
import { only } from "./common";

const { format: stringify } = url;
const IP: unique symbol = Symbol("context#ip");
export class Request {
  public req: IncomingMessage;
  public app: any;
  public ctx: any;
  public response: any;
  public originalUrl: string = "";
  private _querycache = {};
  private memoizedURL;
  public _accept;
  constructor(
    req: IncomingMessage,
    app: any,
    ctx: any,
    response: any,
    originalUrl: string
  ) {
    this.req = req;
    this.app = app;
    this.ctx = ctx;
    this.response = response;
    this.originalUrl = originalUrl;
  }
  public get header() {
    return this.req.headers;
  }
  public set header(val) {
    this.req.headers = val;
  }
  // alias header
  public get headers() {
    return this.req.headers;
  }
  public set headers(val) {
    this.req.headers = val;
  }
  public get method() {
    return this.req.method;
  }
  public set method(val) {
    this.req.method = val;
  }
  public get url() {
    return this.req.url;
  }
  public set url(val) {
    this.req.url = val;
  }
  public get origin() {
    return `${this.protocol}://${this.host}`;
  }
  public get href() {
    // support: `GET http://example.com/foo`
    if (/^https?:\/\//i.test(this.originalUrl)) {
      return this.originalUrl;
    }
    return this.origin + this.originalUrl;
  }
  get path() {
    return parse(this.req)!.pathname;
  }
  set path(path) {
    const url = parse(this.req)!;
    if (url.pathname === path) {
      return;
    }
    url.pathname = path;
    url.path = null;
    this.url = stringify(url);
  }
  public get querystring(): string {
    if (!this.req) {
      return "";
    }
    return (parse(this.req)!.query as string) || "";
  }
  public set querystring(str: string) {
    const url = parse(this.req)!;
    if (url.search === `?${str}`) {
      return;
    }
    url.search = str;
    url.path = null;
    this.url = stringify(url);
  }
  public get query() {
    const str = this.querystring;
    const c = this._querycache;
    return c[str] || (c[str] = qs.parse(str));
  }
  public set query(obj) {
    this.querystring = qs.stringify(obj);
  }
  public get search() {
    if (!this.querystring) {
      return "";
    }
    return `?${this.querystring}`;
  }
  public set search(str: string) {
    this.querystring = str;
  }
  /**
   * Parse the "Host" header field host
   * and support X-Forwarded-Host when a
   * proxy is enabled.
   */
  public get host(): string {
    const proxy = this.app.proxy;
    let host = proxy && this.get("X-Forwarded-Host");
    if (!host) {
      if (this.req.httpVersionMajor >= 2) host = this.get(":authority");
      if (!host) host = this.get("Host");
    }
    if (!host) return "";
    return host.split(/\s*,\s*/, 1)[0];
  }
  public get hostname(): string {
    const host = this.host;
    if (!host) {
      return "";
    }
    // IPv6
    if (host[0] === "[") {
      return (this.URL as URL).hostname || "";
    }
    return host.split(":", 1)[0];
  }
  /**
   * Get WHATWG parsed URL.
   * Lazily memoized.
   */
  public get URL(): URL | Object {
    /* istanbul ignore else */
    if (!this.memoizedURL) {
      const originalUrl = this.originalUrl || ""; // avoid undefined in template string
      try {
        this.memoizedURL = new URL(`${this.origin}${originalUrl}`);
      } catch (err) {
        this.memoizedURL = Object.create(null);
      }
    }
    return this.memoizedURL;
  }
  /**
   * Check if the request is fresh, aka
   * Last-Modified and/or the ETag
   * still match.
   */
  public get fresh(): boolean {
    const method = this.method;
    const s = this.ctx.status;

    // GET or HEAD for weak freshness validation only
    if (method !== "GET" && method !== "HEAD") {
      return false;
    }

    // 2xx or 304 as per rfc2616 14.26
    if ((s >= 200 && s < 300) || s === 304) {
      return fresh(this.header, this.response.header);
    }

    return false;
  }
  /**
   * Check if the request is stale, aka
   * "Last-Modified" and / or the "ETag" for the
   * resource has changed.
   *
   */
  public get stale(): boolean {
    return !this.fresh;
  }
  /**
   * Check if the request is idempotent.
   */

  public get idempotent(): boolean {
    const methods = ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "TRACE"];
    return !!~methods.indexOf(this.method!);
  }
  /**
   * Return the request socket.
   */
  public get socket() {
    return this.req.socket;
  }
  /**
   * Get the charset when present or undefined.
   */
  public get charset(): string {
    try {
      const { parameters } = contentType.parse(this.req);
      return parameters.charset || "";
    } catch (e) {
      return "";
    }
  }
  /**
   * Return parsed Content-Length when present.
   */
  public get length(): number | undefined {
    const len = this.get("Content-Length");
    if (len === "") {
      return;
    }
    return ~~len;
  }
  /**
   * Return the protocol string "http" or "https"
   * when requested with TLS. When the proxy setting
   * is enabled the "X-Forwarded-Proto" header
   * field will be trusted. If you're running behind
   * a reverse proxy that supplies https for you this
   * may be enabled.
   */
  public get protocol(): string {
    // encrypted 确实存在于socket上
    if ((this.socket as any).encrypted) {
      return "https";
    }
    if (!this.app.proxy) {
      return "http";
    }
    const proto = this.get("X-Forwarded-Proto");
    return proto ? proto.split(/\s*,\s*/, 1)[0] : "http";
  }
  /**
   * Shorthand for:
   *
   *    this.protocol == 'https'
   */
  public get secure(): boolean {
    return this.protocol === "https";
  }
  /**
   * When `app.proxy` is `true`, parse
   * the "X-Forwarded-For" ip address list.
   *
   * For example if the value was "client, proxy1, proxy2"
   * you would receive the array `["client", "proxy1", "proxy2"]`
   * where "proxy2" is the furthest down-stream.
   */
  public get ips() {
    const proxy = this.app.proxy;
    const val = this.get(this.app.proxyIpHeader);
    let ips = proxy && val ? val.split(/\s*,\s*/) : [];
    if (this.app.maxIpsCount > 0) {
      ips = ips.slice(-this.app.maxIpsCount);
    }
    return ips;
  }
  /**
   * Return request's remote address
   * When `app.proxy` is `true`, parse
   * the "X-Forwarded-For" ip address list and return the first one
   */
  public get ip() {
    if (!this[IP]) {
      this[IP] = this.ips[0] || this.socket.remoteAddress || "";
    }
    return this[IP];
  }
  /**
   * Return subdomains as an array.
   *
   * Subdomains are the dot-separated parts of the host before the main domain
   * of the app. By default, the domain of the app is assumed to be the last two
   * parts of the host. This can be changed by setting `app.subdomainOffset`.
   *
   * For example, if the domain is "tobi.ferrets.example.com":
   * If `app.subdomainOffset` is not set, this.subdomains is
   * `["ferrets", "tobi"]`.
   * If `app.subdomainOffset` is 3, this.subdomains is `["tobi"]`.
   */
  public get subdomains() {
    const offset = this.app.subdomainOffset;
    const hostname = this.hostname;
    if (net.isIP(hostname)) return [];
    return hostname.split(".").reverse().slice(offset);
  }
  public accepts(...args: any[]) {
    return this.accept.types(...args);
  }
  /**
   * Return accepted encodings or best fit based on `encodings`.
   *
   * Given `Accept-Encoding: gzip, deflate`
   * an array sorted by quality is returned:
   *
   *     ['gzip', 'deflate']
   *
   */
  public acceptsEncodings(...args: string[]) {
    return this.accept.encodings(...args);
  }
  /**
   * Return accepted charsets or best fit based on `charsets`.
   *
   * Given `Accept-Charset: utf-8, iso-8859-1;q=0.2, utf-7;q=0.5`
   * an array sorted by quality is returned:
   *
   *     ['utf-8', 'utf-7', 'iso-8859-1']
   */
  public acceptsCharsets(...args) {
    return this.accept.charsets(...args);
  }
  /**
   * Return accepted languages or best fit based on `langs`.
   *
   * Given `Accept-Language: en;q=0.8, es, pt`
   * an array sorted by quality is returned:
   *
   *     ['es', 'pt', 'en']
   */
  public acceptsLanguages(...args) {
    return this.accept.languages(...args);
  }
  /**
   * Check if the incoming request contains the "Content-Type"
   * header field and if it contains any of the given mime `type`s.
   * If there is no request body, `null` is returned.
   * If there is no content type, `false` is returned.
   * Otherwise, it returns the first `type` that matches.
   *
   * Examples:
   *
   *     // With Content-Type: text/html; charset=utf-8
   *     this.is('html'); // => 'html'
   *     this.is('text/html'); // => 'text/html'
   *     this.is('text/*', 'application/json'); // => 'text/html'
   *
   *     // When Content-Type is application/json
   *     this.is('json', 'urlencoded'); // => 'json'
   *     this.is('application/json'); // => 'application/json'
   *     this.is('html', 'application/*'); // => 'application/json'
   *
   *     this.is('html'); // => false
   */
  public is(type, ...types: string[]): string | false | null {
    return typeis(this.req, type, ...types);
  }
  /**
   * Return the request mime type void of
   * parameters such as "charset".
   */
  public get type() {
    const type = this.get("Content-Type");
    if (!type) {
      return "";
    }
    return type.split(";")[0];
  }
  /**
   * Return request header.
   *
   * The `Referrer` header field is special-cased,
   * both `Referrer` and `Referer` are interchangeable.
   *
   * Examples:
   *
   *     this.get('Content-Type');
   *     // => "text/plain"
   *
   *     this.get('content-type');
   *     // => "text/plain"
   *
   *     this.get('Something');
   *     // => ''
   */
  public get(field: string): string {
    const req = this.req;
    switch ((field = field.toLowerCase())) {
      case "referer":
      case "referrer":
        return (req.headers.referrer as string) || req.headers.referer || "";
      default:
        return (req.headers[field] as string) || "";
    }
  }
  /**
   * Inspect implementation.
   */
  public inspect() {
    if (!this.req) {
      return;
    }
    return this.toJSON();
  }
  /**
   * Return JSON representation.
   */
  public toJSON() {
    return only(this, ["method", "url", "header"]);
  }
  /**
   * Get accept object.
   * Lazily memoized.
   */
  private get accept() {
    return this._accept || (this._accept = accepts(this.req));
  }
  /**
   * Set accept object.
   */
  private set accept(obj) {
    this._accept = obj;
  }
}

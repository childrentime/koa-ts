import assert from "assert";
import { IncomingMessage, ServerResponse } from "http";
import { extname } from "path";
import statuses from "statuses";
import { Stream } from "stream";
import vary from "vary";
import contentDisposition from "content-disposition";
import typeis from "type-is";
import destroy from "destroy";
import onFinish from "on-finished";
import { getType, only } from "./common";

export class Responce {
  public res: ServerResponse;
  public req: IncomingMessage;
  public _explicitStatus: boolean = false;
  public _explicitNullBody: boolean = false;
  private _body: any;
  constructor(responce: ServerResponse, req: IncomingMessage) {
    this.res = responce;
    this.req = req;
  }
  /**
   * Return the request socket.
   */
  public get socket() {
    return this.res.socket;
  }
  /**
   * Return response header.
   */
  public get header() {
    return this.res.getHeaders();
  }
  /**
   * Return response header, alias as response.header
   */
  public get headers() {
    return this.header;
  }
  /**
   * Get response status code.
   */
  public get status() {
    return this.res.statusCode;
  }
  /**
   * Set response status code.
   */
  public set status(code) {
    if (this.headerSent) {
      return;
    }
    assert(Number.isInteger(code), "status code must be a number");
    assert(code >= 100 && code <= 999, `invalid status code: ${code}`);
    this._explicitStatus = true;
    this.res.statusCode = code;
    if (this.req.httpVersionMajor < 2) {
      this.res.statusMessage = statuses[code];
    }
    if (this.body && statuses.empty[code]) {
      this.body = null;
    }
  }
  /**
   * Get response status message
   */
  public get message(): string {
    return this.res.statusMessage || statuses[this.status];
  }
  /**
   * Set response status message
   */
  public set message(msg: string) {
    this.res.statusMessage = msg;
  }
  /**
   * Get response body.
   */
  public get body() {
    return this._body;
  }
  /**
   * Set response body.
   *
   * @param {String|Buffer|Object|Stream} val
   */
  public set body(val) {
    const original = this._body;
    this._body = val;

    // no content
    if (val == null) {
      if (!statuses.empty[this.status]) {
        if (this.type === "application/json") {
          this._body = "null";
          return;
        }
        this.status = 204;
      }
      if (val === null) this._explicitNullBody = true;
      this.remove("Content-Type");
      this.remove("Content-Length");
      this.remove("Transfer-Encoding");
      return;
    }

    // set the status
    if (!this._explicitStatus) this.status = 200;

    // set the content-type only if not yet set
    const setType = !this.has("Content-Type");

    // string
    if (typeof val === "string") {
      if (setType) this.type = /^\s*</.test(val) ? "html" : "text";
      this.length = Buffer.byteLength(val);
      return;
    }

    // buffer
    if (Buffer.isBuffer(val)) {
      if (setType) this.type = "bin";
      this.length = val.length;
      return;
    }

    // stream
    if (val instanceof Stream) {
      onFinish(this.res, destroy.bind(null, val));
      if (original !== val) {
        val.once("error", (err) => this.ctx.onerror(err));
        // overwriting
        if (original != null) this.remove("Content-Length");
      }

      if (setType) this.type = "bin";
      return;
    }

    // json
    this.remove("Content-Length");
    this.type = "json";
  }
  /**
   * Set Content-Length field to `n`.
   */
  public set length(n: number) {
    if (!this.has("Transfer-Encoding")) {
      this.set("Content-Length", n);
    }
  }
  /**
   * Return parsed response Content-Length when present.
   */
  public get length(): number {
    if (this.has("Content-Length")) {
      return parseInt(this.get("Content-Length"), 10) || 0;
    }

    const { body } = this;
    if (!body || body instanceof Stream) return undefined;
    if (typeof body === "string") return Buffer.byteLength(body);
    if (Buffer.isBuffer(body)) return body.length;
    return Buffer.byteLength(JSON.stringify(body));
  }
  /**
   * Check if a header has been written to the socket.
   */
  public get headerSent(): boolean {
    return this.res.headersSent;
  }
  /**
   * Vary on `field`.
   */
  public vary(field: string) {
    if (this.headerSent) {
      return;
    }
    vary(this.res, field);
  }
  /**
   * Perform a 302 redirect to `url`.
   *
   * The string "back" is special-cased
   * to provide Referrer support, when Referrer
   * is not present `alt` or "/" is used.
   *
   * Examples:
   *
   *    this.redirect('back');
   *    this.redirect('back', '/index.html');
   *    this.redirect('/login');
   *    this.redirect('http://google.com');
   */
  public redirect(url: string, alt: string) {
    // location
    if (url === "back") url = this.ctx.get("Referrer") || alt || "/";
    this.set("Location", encodeUrl(url));

    // status
    if (!statuses.redirect[this.status]) this.status = 302;

    // html
    if (this.ctx.accepts("html")) {
      url = escape(url);
      this.type = "text/html; charset=utf-8";
      this.body = `Redirecting to <a href="${url}">${url}</a>.`;
      return;
    }

    // text
    this.type = "text/plain; charset=utf-8";
    this.body = `Redirecting to ${url}.`;
  }
  /**
   * Set Content-Disposition header to "attachment" with optional `filename`.
   */
  public attachment(filename: string, options) {
    if (filename) {
      this.type = extname(filename);
    }
    this.set("Content-Disposition", contentDisposition(filename, options));
  }
  /**
   * Set Content-Type response header with `type` through `mime.lookup()`
   * when it does not contain a charset.
   *
   * Examples:
   *
   *     this.type = '.html';
   *     this.type = 'html';
   *     this.type = 'json';
   *     this.type = 'application/json';
   *     this.type = 'png';
   */
  public set type(type: string) {
    type = getType(type);
    if (type) {
      this.set("Content-Type", type);
    } else {
      this.remove("Content-Type");
    }
  }
  /**
   * Set the Last-Modified date using a string or a Date.
   *
   *     this.response.lastModified = new Date();
   *     this.response.lastModified = '2013-09-13';
   */
  public set lastModified(val: String | Date) {
    if (typeof val === "string") {
      val = new Date(val);
    }
    this.set("Last-Modified", (val as Date).toUTCString());
  }
  /**
   * Get the Last-Modified date in Date form, if it exists.
   */
  public get lastModified() {
    const date = this.get("last-modified");
    if (date) {
      return new Date(date);
    }
  }
  /**
   * Set the ETag of a response.
   * This will normalize the quotes if necessary.
   *
   *     this.response.etag = 'md5hashsum';
   *     this.response.etag = '"md5hashsum"';
   *     this.response.etag = 'W/"123456789"';
   */
  public set etag(val: string) {
    if (!/^(W\/)?"/.test(val)) {
      val = `"${val}"`;
    }
    this.set("ETag", val);
  }
  /**
   * Get the ETag of a response.
   */
  public get etag(): string {
    return this.get("ETag");
  }
  /**
   * Return the response mime type void of
   * parameters such as "charset".
   */
  public get type(): string {
    const type = this.get("Content-Type");
    if (!type) {
      return "";
    }
    return type.split(";", 1)[0];
  }
  /**
   * Check whether the response is one of the listed types.
   * Pretty much the same as `this.request.is()`.
   */
  public is(type, ...types) {
    return typeis(this.type, type, ...types);
  }
  /**
   * Return response header.
   *
   * Examples:
   *
   *     this.get('Content-Type');
   *     // => "text/plain"
   *
   *     this.get('content-type');
   *     // => "text/plain"
   */
  public get(field: string) {
    return this.res.getHeader(field);
  }
  /**
   * Returns true if the header identified by name is currently set in the outgoing headers.
   * The header name matching is case-insensitive.
   *
   * Examples:
   *
   *     this.has('Content-Type');
   *     // => true
   *
   *     this.get('content-type');
   *     // => true
   */
  public has(field: string): boolean {
    return this.res.hasHeader(field);
  }
  /**
   * Set header `field` to `val` or pass
   * an object of header fields.
   *
   * Examples:
   *
   *    this.set('Foo', ['bar', 'baz']);
   *    this.set('Accept', 'application/json');
   *    this.set({ Accept: 'text/plain', 'X-API-Key': 'tobi' });
   */
  public set(field, val) {
    if (this.headerSent) {
      return;
    }

    if (arguments.length === 2) {
      if (Array.isArray(val))
        val = val.map((v) => (typeof v === "string" ? v : String(v)));
      else if (typeof val !== "string") val = String(val);
      this.res.setHeader(field, val);
    } else {
      for (const key in field) {
        this.set(key, field[key]);
      }
    }
  }
  /**
   * Append additional header `field` with value `val`.
   *
   * Examples:
   *
   * ```
   * this.append('Link', ['<http://localhost/>', '<http://localhost:3000/>']);
   * this.append('Set-Cookie', 'foo=bar; Path=/; HttpOnly');
   * this.append('Warning', '199 Miscellaneous warning');
   * ```
   */
  public append(field, val) {
    const prev = this.get(field);
    if (prev) {
      val = Array.isArray(prev) ? prev.concat(val) : [prev].concat(val);
    }
    return this.set(field, val);
  }
  /**
   * Remove header `field`.
   */
  public remove(field) {
    if (this.headerSent) {
      return;
    }
    this.res.removeHeader(field);
  }
  /**
   * Checks if the request is writable.
   * Tests for the existence of the socket
   * as node sometimes does not set it.
   */
  public get writable(): boolean {
    // can't write any more after response finished
    // response.writableEnded is available since Node > 12.9
    // https://nodejs.org/api/http.html#http_response_writableended
    // response.finished is undocumented feature of previous Node versions
    // https://stackoverflow.com/questions/16254385/undocumented-response-finished-in-node-js
    if (this.res.writableEnded || this.res.finished) {
      return false;
    }

    const socket = this.res.socket;
    // There are already pending outgoing res, but still writable
    // https://github.com/nodejs/node/blob/v4.4.7/lib/_http_server.js#L486
    if (!socket) {
      return true;
    }
    return socket.writable;
  }
  /**
   * Inspect implementation.
   */
  public inspect() {
    if (!this.res) return;
    const o = this.toJSON();
    o.body = this.body;
    return o;
  }
  /**
   * Return JSON representation.
   */
  public toJSON() {
    return only(this, ["status", "message", "header"]);
  }
  /**
   * Flush any set headers and begin the body
   */
  public flushHeaders() {
    this.res.flushHeaders();
  }
}

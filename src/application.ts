import { EventEmitter } from "events";
import util from "util";
import compose from "koa-compose";
import { only } from "./common";
import context, { Context } from "./context";

interface Options {
  env?: string;
  keys?: string[];
  proxy?: boolean;
  subdomainOffset?: number;
  proxyIpHeader?: string;
  maxIpsCount?: number;
  compose?: (args: any[]) => any;
  slient?: boolean;
}
class Application extends EventEmitter {
  public proxy: boolean;
  public subdomainOffset: number;
  public proxyIpHeader: string;
  public maxIpsCount: number;
  public env: string;
  public compose: (args: any[]) => any;
  public keys: string[];
  middleware;
  public context: Context;
  request;
  response;
  public silent: boolean;

  constructor(options: Options = {}) {
    super();
    this.proxy = options.proxy || false;
    this.subdomainOffset = options.subdomainOffset || 2;
    this.proxyIpHeader = options.proxyIpHeader || "X-Forwarded-For";
    this.maxIpsCount = options.maxIpsCount || 0;
    this.env = options.env || process.env.NODE_ENV || "development";
    this.compose = options.compose || compose;
    this.keys = options.keys || [];
    this.silent = options.slient || false;
    this.middleware = [];
    this.context = Object.create(context);
    this.request = Object.create(request);
    this.response = Object.create(response);
    // util.inspect.custom support for node 6+
    /* istanbul ignore else */
    if (util.inspect.custom) {
      this[util.inspect.custom] = this.inspect;
    }
  }

  public inspect() {
    return this.toJSON();
  }

  public toJSON() {
    return only(this, ["subdomainOffset", "proxy", "env"]);
  }
}

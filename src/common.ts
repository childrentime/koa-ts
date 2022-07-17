import mimeTypes from "mime-types";
import LRU from "ylru";

export type AnyObject = { [key: string]: any };
export const only = (obj: AnyObject = {}, keys: string[]): AnyObject => {
  return keys.reduce((ret, key) => {
    if (null == obj[key]) {
      return ret;
    }
    ret[key] = obj[key];
    return ret;
  }, {});
};

const typeLRUCache = new LRU(100);
export const getType = (type: string) => {
  let mimeType = typeLRUCache.get(type);
  if (!mimeType) {
    mimeType = mimeTypes.contentType(type);
    typeLRUCache.set(type, mimeType);
  }
  return mimeType;
};

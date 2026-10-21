/**
 * Minimal types for jsfive 0.4 (public domain, https://github.com/usnistgov/jsfive),
 * a pure-JavaScript HDF5 reader, which ships none. Only the parts the GLM
 * lightning reader uses (src/lib/server/glm.ts).
 */
declare module "jsfive" {
  export class Dataset {
    readonly shape: number[];
    readonly dtype: string | unknown[];
    readonly attrs: Record<string, unknown>;
    /** The whole dataset, decompressed (a plain array for numeric data). */
    readonly value: ArrayLike<number>;
  }

  export class Group {
    readonly keys: string[];
    readonly attrs: Record<string, unknown>;
    /** Throws (not always an Error) when there's no such member. */
    get(path: string): Dataset | Group;
  }

  export class File extends Group {
    /** Throws (not always an Error) when the bytes aren't HDF5. */
    constructor(buffer: ArrayBuffer, filename?: string);
  }
}

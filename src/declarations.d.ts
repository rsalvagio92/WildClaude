// Type declarations for untyped npm packages.
// Prevents tsc from exiting with non-zero on build.

declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string, options?: any);
    exec(sql: string): this;
    prepare(sql: string): any;
    pragma(pragma: string, options?: any): any;
    close(): void;
    transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
    backup(destination: string, options?: any): Promise<any>;
  }

  namespace Database {
    type Database = InstanceType<typeof import('better-sqlite3')>;
  }

  export = Database;
}

declare module 'js-yaml' {
  export function load(input: string): any;
  export function dump(obj: any, options?: any): string;
}

declare module 'qrcode-terminal' {
  export function generate(text: string, options?: any, callback?: (qrcode: string) => void): void;
}

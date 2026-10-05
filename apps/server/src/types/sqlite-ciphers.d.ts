// better-sqlite3-multiple-ciphers is better-sqlite3 with encryption built in (same API). Its own
// typings aren't reachable through its package "exports", so reuse better-sqlite3's.
declare module 'better-sqlite3-multiple-ciphers' {
  import Database from 'better-sqlite3';
  export = Database;
}

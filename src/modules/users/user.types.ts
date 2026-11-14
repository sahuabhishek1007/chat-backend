export interface User {
  id: string;
  name: string;
  createdAt: Date;
}

export interface UserRepository {
  create(name: string): Promise<User>;
  findById(id: string): Promise<User | null>;
  /** Returns the subset of `ids` that exist. */
  findExistingIds(ids: readonly string[]): Promise<Set<string>>;
}

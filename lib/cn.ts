/**
 * Tiny class-name combiner. Filters out falsy values so components can write
 * `cn("base", isActive && "active")` without pulling in a dependency.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

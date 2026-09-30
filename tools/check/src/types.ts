/** One finding of a check, pointing at a line of a file relative to the repository root. */
export interface Problem {
  file: string
  line: number
  message: string
}

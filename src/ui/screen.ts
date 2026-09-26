/** Screen contract: mount into a root element, return a cleanup function. */
export type Cleanup = () => void;

export type Navigate = (hash: string, opts?: { replace?: boolean }) => void;

export interface ScreenContext {
  root: HTMLElement;
  navigate: Navigate;
}

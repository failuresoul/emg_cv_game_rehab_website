/**
 * Everything a session page starts that must stop when the patient leaves: game loops, the
 * camera and speech. Every exit path (the Exit button, Start over, Back to home, the error page
 * and leaving the session pages by any other route) calls stopSession() from ./stopSession.
 */

type Stopper = () => void;

export class StopRegistry {
  private stoppers = new Set<Stopper>();

  /** Adds a stopper; the returned function removes it again, such as on unmount. */
  register(stop: Stopper): () => void {
    this.stoppers.add(stop);
    return () => {
      this.stoppers.delete(stop);
    };
  }

  /** Runs and removes every stopper. One that throws does not keep the others from running. */
  stopAll(): number {
    const stoppers = [...this.stoppers];
    this.stoppers.clear();
    for (const stop of stoppers) {
      try {
        stop();
      } catch {
        // Stopping is best effort.
      }
    }
    return stoppers.length;
  }

  get size(): number {
    return this.stoppers.size;
  }
}

/** Game loops and other per-page work; stopSession() in ./stopSession also stops the camera. */
export const sessionStops = new StopRegistry();

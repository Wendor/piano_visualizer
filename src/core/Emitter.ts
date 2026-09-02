/** Минимальный типизированный эмиттер событий сцены. */

export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class Emitter<Events extends Record<string, unknown>> {
    private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

    on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener as Listener<never>);
        return () => this.off(event, listener);
    }

    off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
        this.listeners.get(event)?.delete(listener as Listener<never>);
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        const set = this.listeners.get(event);
        if (!set) return;
        for (const listener of [...set]) (listener as Listener<Events[K]>)(payload);
    }

    clear(): void {
        this.listeners.clear();
    }
}

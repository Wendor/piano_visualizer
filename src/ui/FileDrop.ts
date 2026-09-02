/** Приём .mid: перетаскиванием на окно или выбором файла. */
export class FileDrop {
    private readonly overlay: HTMLElement;
    private readonly picker: HTMLInputElement;
    private depth = 0;

    constructor(private readonly onFile: (file: File) => void) {
        this.overlay = document.createElement("div");
        this.overlay.className = "filedrop";
        this.overlay.innerHTML = `<div class="filedrop__box">Отпустите MIDI-файл</div>`;
        document.body.appendChild(this.overlay);

        this.picker = document.createElement("input");
        this.picker.type = "file";
        this.picker.accept = ".mid,.midi,audio/midi";
        this.picker.className = "filedrop__input";
        this.picker.addEventListener("change", () => {
            const file = this.picker.files?.[0];
            if (file) this.onFile(file);
            this.picker.value = "";
        });
        document.body.appendChild(this.picker);

        window.addEventListener("dragenter", this.onEnter);
        window.addEventListener("dragover", this.onOver);
        window.addEventListener("dragleave", this.onLeave);
        window.addEventListener("drop", this.onDrop);
    }

    /** Открыть системный выбор файла. */
    open(): void {
        this.picker.click();
    }

    dispose(): void {
        window.removeEventListener("dragenter", this.onEnter);
        window.removeEventListener("dragover", this.onOver);
        window.removeEventListener("dragleave", this.onLeave);
        window.removeEventListener("drop", this.onDrop);
        this.overlay.remove();
        this.picker.remove();
    }

    private readonly onEnter = (event: DragEvent): void => {
        event.preventDefault();
        this.depth++;
        this.overlay.classList.add("filedrop--on");
    };

    private readonly onOver = (event: DragEvent): void => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    private readonly onLeave = (event: DragEvent): void => {
        event.preventDefault();
        this.depth = Math.max(0, this.depth - 1);
        if (this.depth === 0) this.overlay.classList.remove("filedrop--on");
    };

    private readonly onDrop = (event: DragEvent): void => {
        event.preventDefault();
        this.depth = 0;
        this.overlay.classList.remove("filedrop--on");
        const file = event.dataTransfer?.files?.[0];
        if (file) this.onFile(file);
    };
}

/** «12 нот», «2 ноты», «21 нота». */
export function notesWord(count: number): string {
    const tail = count % 100;
    if (tail >= 11 && tail <= 14) return "нот";
    switch (count % 10) {
        case 1:
            return "нота";
        case 2:
        case 3:
        case 4:
            return "ноты";
        default:
            return "нот";
    }
}

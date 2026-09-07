export const pluralRules = {
  'ru-RU': (choice: number, choicesLength: number) => {
    if (choicesLength !== 4) {
      return Math.min(Math.abs(choice), choicesLength - 1)
    }

    const absoluteChoice = Math.abs(choice)
    if (absoluteChoice === 0) {
      return 0
    }

    const mod10 = absoluteChoice % 10
    const mod100 = absoluteChoice % 100
    if (mod10 === 1 && mod100 !== 11) {
      return 1
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return 2
    }
    return 3
  },
  'pl-PL': (choice: number, choicesLength: number) => {
    if (choicesLength !== 4) {
      return Math.min(Math.abs(choice), choicesLength - 1)
    }

    const absoluteChoice = Math.abs(choice)
    if (absoluteChoice === 0) {
      return 0
    }

    const mod10 = absoluteChoice % 10
    const mod100 = absoluteChoice % 100
    if (absoluteChoice === 1) {
      return 1
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
      return 2
    }
    return 3
  }
}

export function calculatePayment(
  baseAmount: number,
  interestRate: number,
  totalMonths: number,
  monthNumber: number
): number {
  if (monthNumber === 1 || monthNumber === totalMonths) {
    return Math.round(baseAmount);
  }

  return Math.round(baseAmount * (1 - interestRate * (totalMonths - monthNumber)));
}

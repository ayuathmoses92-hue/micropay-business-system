export function authorizeRequest(req, res, next) {
  const role = req.user?.role;
  if (role === "ADMIN" || role === "MANAGER") return next();
  const path = req.path;
  const method = req.method;

  const financeOnly =
    path.startsWith("/invoices") || path.startsWith("/receipts") ||
    path.startsWith("/expenses") || path.startsWith("/payment-vouchers") ||
    path.startsWith("/documents/invoice") || path.startsWith("/documents/receipt") ||
    path.startsWith("/documents/expense") || path.startsWith("/documents/payment-voucher");

  if (role === "FINANCE") return next();
  if (role === "CLERK") {
    if (financeOnly) return res.status(403).json({ error: "Your role does not have access to this area" });
    if (path === "/dashboard" && method === "GET") return next();
    if (path.startsWith("/customers") || path.startsWith("/quotations") || path.startsWith("/documents/quotation")) return next();
  }
  return res.status(403).json({ error: "Your role does not have access to this action" });
}

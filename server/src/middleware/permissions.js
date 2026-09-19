// ERP-wide permission engine.
// Legacy roles remain supported while users can also receive one or more configurable roles.

const legacyRoles = new Set(["ADMIN", "MANAGER", "FINANCE", "CLERK"]);

function actionFor(req) {
  const parts = String(req.path || "").split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (["approve","reject","cancel","submit","issue","post","complete","reopen","convert","pay","payments","adjust","adjustment","activate","deactivate","reset-password","delete"].includes(last)) return last === "reset-password" ? "reset_password" : (last === "payments" ? "pay" : (last === "adjustment" ? "adjust" : last));
  if (req.method === "GET") return "view";
  if (req.method === "POST") return "create";
  if (req.method === "PATCH" || req.method === "PUT") return "edit";
  if (req.method === "DELETE") return "delete";
  return "view";
}

export function permissionForRequest(req) {
  const p = String(req.path || "");
  const action = actionFor(req);
  const exact = [
    [/^\/procurement\/requisitions(?:\/[^/]+)*$/, `procurement.requisitions.${action}`],
    [/^\/procurement\/rfqs(?:\/[^/]+)*$/, `procurement.rfqs.${action}`],
    [/^\/procurement\/supplier-quotes(?:\/[^/]+)*$/, `procurement.supplier_quotes.${action}`],
    [/^\/procurement\/purchase-orders(?:\/[^/]+)*$/, `procurement.purchase_orders.${action}`],
    [/^\/procurement\/goods-receipts(?:\/[^/]+)*$/, `procurement.goods_receipts.${action}`],
  ];
  for (const [rx, code] of exact) if (rx.test(p)) return code;

  const map = [
    [/^\/customers/, `customers.${action}`],
    [/^\/quotations/, `quotations.${action}`],
    [/^\/invoices/, `invoices.${action}`],
    [/^\/receipts/, `receipts.${action}`],
    [/^\/expenses/, `expenses.${action}`],
    [/^\/payment-vouchers/, `payment_vouchers.${action}`],
    [/^\/financial-accounts/, `financial_accounts.${action}`],
    [/^\/reconciliations/, `reconciliation.${action}`],
    [/^\/budgets/, `budgets.${action}`],
    [/^\/phase4\/currencies/, `currencies.${action === "edit" ? "manage" : action}`],
    [/^\/phase4\/exchange-rates/, `currencies.${action === "create" || action === "edit" || action === "delete" ? "manage" : "view"}`],
    [/^\/phase4\/suppliers/, `suppliers.${action}`],
    [/^\/phase4\/bills/, `supplier_bills.${action}`],
    [/^\/phase4\/customer-statements/, "statements.view"],
    [/^\/phase4\/credit-notes/, `invoices.${action}`],
    [/^\/phase4\/periods/, `periods.${action}`],
    [/^\/phase4\/profitability/, "profitability.view"],
    [/^\/dashboard/, "dashboard.view"],
    [/^\/reports/, "reports.view"],
    [/^\/documents\//, "reports.view"],
  ];
  for (const [rx, code] of map) if (rx.test(p)) return code;
  return null;
}

export function hasPermission(req, permission) {
  const role = req.user?.role;
  if (role === "ADMIN") return true;
  const permissions = new Set(req.user?.permissions || []);
  return permissions.has(permission) || permissions.has(`${permission.split(".")[0]}.*`) || permissions.has("*");
}

export function hasPermissionForRequest(req) {
  const permission = permissionForRequest(req);
  return permission ? hasPermission(req, permission) : false;
}

// Used by existing route handlers. A legacy role continues to work exactly as before;
// configurable roles are authorized from their assigned permission set.
export function authorizeLegacyOrPermission(req, res, roles) {
  if (req.user?.role === "ADMIN") return true;
  const permission = permissionForRequest(req);
  if (permission) return hasPermission(req, permission) || (roles.includes(req.user?.role) && legacyRoles.has(req.user?.role) && !req.user?.permissions?.length);
  if (roles.includes(req.user?.role)) return true;
  res.status(403).json({ error: "You do not have permission for this action" });
  return false;
}

export function authorizeRequest(req, res, next) {
  if (req.user?.role === "ADMIN") return next();
  const permission = permissionForRequest(req);
  if (permission) return hasPermission(req, permission) ? next() : res.status(403).json({ error: "Your assigned roles do not grant access to this action" });
  if (legacyRoles.has(req.user?.role)) return next();
  return res.status(403).json({ error: "Your assigned roles do not grant access to this action" });
}

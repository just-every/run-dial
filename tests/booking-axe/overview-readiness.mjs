export function overviewCards(page) {
  return {
    bookingCard: page.getByRole("heading", { name: "Bookings", exact: true }).locator("xpath=ancestor::section[1]"),
    requestCard: page.getByRole("heading", { name: "Alternative requests", exact: true }).locator("xpath=ancestor::section[1]"),
  };
}

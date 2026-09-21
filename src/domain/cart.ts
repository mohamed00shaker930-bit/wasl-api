/** Cart line as sent by clients (web localStorage cart / Flutter cart). Prices are re-read server-side. */
export type CartItem = {
  productId: string;
  name: string;
  price: number;
  qty: number;
  note?: string;
  imageUrl?: string | null;
};

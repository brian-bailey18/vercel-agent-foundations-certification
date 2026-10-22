import { tool } from "ai";
import { z } from "zod";
import { ApiRequestError, createReturn, getCategories, getOrder, getProductById, getProducts, getProductStock, preauthorizeRefund, notifyReturnInProcess } from "@/lib/api";
import { formatPrice } from "@/lib/format";

export const searchProducts = tool({
  description: `Search the Vercel swag store catalog and return a short summary of matching products (name, price in cents, category, one image, description). Use this for broad lookups: what the store sells, recommendations, browsing a category, or finding which product matches a name. It does not include live stock, extra images, or tags. When the user asks about one specific item, take the matching id or slug from these results and call getProductDetails instead of answering from this summary.`,
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        `Optional free-text search terms describing what the user is looking for, e.g. 'hoodie' or 'water bottle'.`,
      ),
    category: z
      .string()
      .optional()
      .describe(
        `Optional category slug to filter results. Only set this when the user clearly wants a specific category. Use the getAllCategories tool to get all valid categories.`,
      ),
  }),
  execute: async ({ query, category }) => {
    try {
      const products = await getProducts({
        search: query,
        category,
        limit: 10,
      });
      return {
        count: products.length,
        products: products.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          image: p.images[0],
          price: p.price,
          currency: p.currency,
          category: p.category,
          description: p.description,
        })),
      };
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Unknown error";
      return { count: 0, products: [], error: message };
    }
  },
});

export const getProductDetails = tool({
  description: `Fetch the full record for a single product: description, price, every image, tags, live stock, and a few related products. Use this whenever the user asks about one specific item (for example "Tell me more about the black hoodie"), including availability, what it looks like, or how it compares to similar items. Pass a product id or slug. If you only know the name, call searchProducts first to find the id or slug, then call this tool. Do not use this to browse or list many products — searchProducts is for that. The catalog does not sell separate sizes; do not invent them.`,
  inputSchema: z.object({
    idOrSlug: z
      .string()
      .describe(
        `Product id or slug. Use the id or slug returned by searchProducts when the user named a product instead of giving an id.`,
      ),
  }),
  execute: async ({ idOrSlug }) => {
    try {
      const productPromise = getProductById(idOrSlug);
      const stockPromise = getProductStock(idOrSlug);
      const fallbackPromise = getProducts({ limit: 12 }).catch(() => []);
      const product = await productPromise;
      const categoryPromise = getProducts({
        category: product.category,
        limit: 8,
      }).catch(() => []);

      const [stock, byCategory, fallback] = await Promise.all([
        stockPromise,
        categoryPromise,
        fallbackPromise,
      ]);

      const seen = new Set<string>([product.id]);
      const related: {
        id: string;
        name: string;
        slug: string;
        price: number;
        formattedPrice: string;
        currency: string;
      }[] = [];
      for (const list of [byCategory, fallback]) {
        for (const item of list) {
          if (related.length >= 4) break;
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          related.push({
            id: item.id,
            name: item.name,
            slug: item.slug,
            price: item.price,
            formattedPrice: formatPrice(item.price, item.currency),
            currency: item.currency,
          });
        }
      }

      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        formattedPrice: formatPrice(product.price, product.currency),
        currency: product.currency,
        category: product.category,
        images: product.images,
        featured: product.featured,
        tags: product.tags,
        stock: stock.stock,
        inStock: stock.inStock,
        lowStock: stock.lowStock,
        related,
      };
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Unknown error";
      return { error: message };
    }
  },
});

export const getAllCategories = tool({
  description: `List every product category available in the Vercel swag store, along with the number of products in each. Use this when the user asks what categories exist, what kinds of products are sold, or wants to browse the store at a high level.`,
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const categories = await getCategories();
      return {
        count: categories.length,
        categories: categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          productCount: c.productCount,
        })),
      };
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Unknown error";
      return { count: 0, categories: [], error: message };
    }
  },
});

export const returnOrder = tool({
  description: `File a return for one of the user's past orders. The user must provide an order ID and a reason. Example order IDs: 11111, 22222, 33333.`,
  inputSchema: z.object({
    orderId: z
      .string()
      .describe("The order ID the user wants to return."),
    reason: z
      .string()
      .min(10)
      .max(500)
      .describe("Why the user is returning the order."),
  }),
  execute: async ({ orderId, reason }) => {
    try {
      const order = await getOrder(orderId);
      await notifyReturnInProcess(orderId);
      await preauthorizeRefund(orderId);
      const filed = await createReturn({
        orderId: order.id,
        items: order.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
        reason,
      });
      return { returnId: filed.id, status: filed.status };
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Unknown error";
      return { error: message };
    }
  },
});
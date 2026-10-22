import { tool } from "ai";
import { z } from "zod";
import { ApiRequestError, createReturn, getCategories, getOrder, getProductById, getProductStock, getProducts, preauthorizeRefund, notifyReturnInProcess } from "@/lib/api";
import { start } from "workflow/api";
import { returnFlow } from "./workflows/return-flow";

export const searchProducts = tool({
  description: `Search the Vercel swag store product catalog. Use this whenever the user asks about products, what the store sells, or wants recommendations. Optionally narrow results to a single category.`,
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
    "use step";
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

export const getAllCategories = tool({
  description: `List every product category available in the Vercel swag store, along with the number of products in each. Use this when the user asks what categories exist, what kinds of products are sold, or wants to browse the store at a high level.`,
  inputSchema: z.object({}),
  execute: async () => {
    "use step";
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
    "use step";
    const run = await start(returnFlow, [orderId, reason]);
    return { runId: run.runId, message: `Return request received for order ${orderId}.` };
  },
});

export const getProductDetails = tool({
  description: `Fetch the full details for a single product by its ID or slug, including every image, the full description, price, tags, and live stock levels. Use this when the user asks about a specific item (e.g. "tell me more about the black hoodie") — prefer it over searchProducts once you know which product they mean, since searchProducts only returns a summary.`,
  inputSchema: z.object({
    productId: z
      .string()
      .describe(
        "The product's ID or slug, as returned by searchProducts (the id or slug field).",
      ),
  }),
  execute: async ({ productId }) => {
    "use step";
    try {
      const [product, stock] = await Promise.all([
        getProductById(productId),
        getProductStock(productId),
      ]);
      return {
        id: product.id,
        name: product.name,
        slug: product.slug,
        description: product.description,
        price: product.price,
        currency: product.currency,
        category: product.category,
        images: product.images,
        tags: product.tags,
        featured: product.featured,
        stock: stock.stock,
        inStock: stock.inStock,
        lowStock: stock.lowStock,
      };
    } catch (err) {
      const message =
        err instanceof ApiRequestError ? err.message : "Unknown error";
      return { error: message };
    }
  },
});
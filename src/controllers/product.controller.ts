import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export class ProductController {
  async create(req: Request, res: Response) {
    const product = await prisma.product.create({
      data: req.body
    });

    return res.json(product);
  }

  async list(req: Request, res: Response) {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' }
    });

    return res.json(products);
  }

  async update(req: Request, res: Response) {
    const id = req.params.id as string;

    const product = await prisma.product.update({
      where: { id },
      data: req.body
    });

    return res.json(product);
  }

  async updateStock(req: Request, res: Response) {
    const id = req.params.id as string;
    const { stock } = req.body;

    const product = await prisma.product.update({
      where: { id },
      data: { stock }
    });

    return res.json(product);
  }

  async movement(req: Request, res: Response) {
    const id = req.params.id as string;
    const { type, quantity, note } = req.body;

    const product = await prisma.product.findUnique({
      where: { id }
    });

    if (!product) {
      return res.status(404).json({ message: 'Produto não encontrado' });
    }

    let newStock = product.stock;

    if (type === 'ENTRY') newStock += quantity;
    if (type === 'OUTPUT') newStock -= quantity;

    if (newStock < 0) {
      return res.status(400).json({ message: 'Estoque insuficiente' });
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: { stock: newStock }
    });

    await prisma.stockMovement.create({
      data: {
        productId: id,
        type,
        quantity,
        note
      }
    });

    return res.json(updatedProduct);
  }

  async movements(req: Request, res: Response) {
    const movements = await prisma.stockMovement.findMany({
      include: { product: true },
      orderBy: { createdAt: 'desc' }
    });

    return res.json(movements);
  }

  async lowStock(req: Request, res: Response) {
    const products = await prisma.product.findMany();

    const lowStockProducts = products.filter(
      product => product.stock <= product.minimumStock
    );

    return res.json(lowStockProducts);
  }
}

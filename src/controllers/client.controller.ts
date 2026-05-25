import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export class ClientController {
  async create(req: Request, res: Response) {
    try {
      const { name, phone, email, address } = req.body;

      const client = await prisma.client.create({
        data: {
          name,
          phone,
          email,
          address
        }
      });

      return res.json(client);
    } catch {
      return res.status(500).json({
        message: 'Erro ao criar cliente'
      });
    }
  }

  async list(req: Request, res: Response) {
    const clients = await prisma.client.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(clients);
  }

  async update(req: Request, res: Response) {
    const id = req.params.id as string;

    const { name, phone, email, address } = req.body;

    const client = await prisma.client.update({
      where: { id },
      data: {
        name,
        phone,
        email,
        address
      }
    });

    return res.json(client);
  }

  async delete(req: Request, res: Response) {
    const id = req.params.id as string;

    await prisma.client.delete({
      where: { id }
    });

    return res.json({
      message: 'Cliente removido com sucesso'
    });
  }
}
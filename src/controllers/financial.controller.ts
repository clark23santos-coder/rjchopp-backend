
import { Request, Response } from 'express';
import { prisma } from '../database/prisma';

export class FinancialController {
  async create(req: Request, res: Response) {
    try {
      const {
        type,
        category,
        description,
        amount
      } = req.body;

      const transaction = await prisma.financialTransaction.create({
        data: {
          type,
          category,
          description,
          amount
        }
      });

      return res.json(transaction);

    } catch (error) {
      console.log(error);

      return res.status(500).json({
        message: 'Erro ao criar transação'
      });
    }
  }

  async list(req: Request, res: Response) {
    const transactions = await prisma.financialTransaction.findMany({
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(transactions);
  }

  async summary(req: Request, res: Response) {
    const entries = await prisma.financialTransaction.aggregate({
      where: {
        type: 'ENTRY'
      },
      _sum: {
        amount: true
      }
    });

    const outputs = await prisma.financialTransaction.aggregate({
      where: {
        type: 'OUTPUT'
      },
      _sum: {
        amount: true
      }
    });

    const totalEntries = entries._sum.amount || 0;
    const totalOutputs = outputs._sum.amount || 0;

    return res.json({
      entries: totalEntries,
      outputs: totalOutputs,
      balance: totalEntries - totalOutputs
    });
  }
}
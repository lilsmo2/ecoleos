import { Router } from "express";
import { authenticate, schoolGuard, roleGuard } from "../middleware/auth.js";

/**
 * Create a CRUD router for a per-school entity.
 * @param {Model} Model - Mongoose model
 * @param {Object} opts - { readRoles, writeRoles, deleteRoles }
 */
export function createCrudRouter(Model, opts = {}) {
  const router = Router({ mergeParams: true });
  const readRoles = opts.readRoles || ["admin", "directeur", "secretaire", "enseignant", "comptable"];
  const writeRoles = opts.writeRoles || ["admin"];
  const deleteRoles = opts.deleteRoles || ["admin"];

  // GET /api/schools/:schoolId/<entity>
  router.get("/", authenticate, schoolGuard, roleGuard(readRoles), async (req, res) => {
    try {
      const items = await Model.find({ schoolId: req.params.schoolId, deletedAt: null }).lean();
      res.json({ data: items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/schools/:schoolId/<entity>/:id
  router.get("/:id", authenticate, schoolGuard, roleGuard(readRoles), async (req, res) => {
    try {
      const item = await Model.findById(req.params.id).lean();
      if (!item || item.schoolId !== req.params.schoolId) {
        return res.status(404).json({ error: "Introuvable" });
      }
      res.json({ data: item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/schools/:schoolId/<entity>
  router.post("/", authenticate, schoolGuard, roleGuard(writeRoles), async (req, res) => {
    try {
      const item = await Model.create({ ...req.body, schoolId: req.params.schoolId });
      res.status(201).json({ data: item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/schools/:schoolId/<entity>/:id
  router.put("/:id", authenticate, schoolGuard, roleGuard(writeRoles), async (req, res) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
      if (!item) return res.status(404).json({ error: "Introuvable" });
      res.json({ data: item });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/schools/:schoolId/<entity>/:id (soft delete)
  router.delete("/:id", authenticate, schoolGuard, roleGuard(deleteRoles), async (req, res) => {
    try {
      await Model.findByIdAndUpdate(req.params.id, { deletedAt: new Date() });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

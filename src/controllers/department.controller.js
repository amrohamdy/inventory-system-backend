const departmentService = require('../services/department.service');
const { success, created } = require('../utils/response');

const createDepartment = async (req, res, next) => {
    try {
        const dept = await departmentService.createDepartment(req.body, req.user.tenantId);
        return created(res, dept, 'Department created');
    } catch (err) { next(err); }
};

const getDepartments = async (req, res, next) => {
    try {
        const result = await departmentService.getDepartments(req.user.tenantId, req.query);
        return success(res, result.departments, { total: result.total });
    } catch (err) { next(err); }
};

const getDepartment = async (req, res, next) => {
    try {
        const dept = await departmentService.getDepartmentById(req.params.id, req.user.tenantId);
        return success(res, dept);
    } catch (err) { next(err); }
};

const updateDepartment = async (req, res, next) => {
    try {
        const dept = await departmentService.updateDepartment(req.params.id, req.body, req.user.tenantId);
        return success(res, dept, 'Department updated');
    } catch (err) { next(err); }
};

const deleteDepartment = async (req, res, next) => {
    try {
        await departmentService.deleteDepartment(req.params.id, req.user.tenantId);
        return success(res, null, 'Department deleted');
    } catch (err) { next(err); }
};

const toggleDepartment = async (req, res, next) => {
    try {
        const dept = await departmentService.toggleDepartment(req.params.id, req.user.tenantId);
        return success(res, dept, `Department ${dept.isActive ? 'activated' : 'deactivated'}`);
    } catch (err) { next(err); }
};

module.exports = { createDepartment, getDepartments, getDepartment, updateDepartment, deleteDepartment, toggleDepartment };

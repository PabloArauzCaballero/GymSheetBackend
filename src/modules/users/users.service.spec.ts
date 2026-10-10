import { UnprocessableEntityException } from "@nestjs/common";
import { UsersRepository } from "./users.repository";
import { UsersService } from "./users.service";

const SEDE = "3f1c2b7e-8a4d-4c1e-9b2a-5d6e7f8a9b0c";

function setup(branchValid: boolean) {
  const user = { id: "u1", tenantId: "gym-a", update: jest.fn() };
  const repository = {
    findActiveById: jest.fn().mockResolvedValue(user),
    isActiveBranchInTenant: jest.fn().mockResolvedValue(branchValid),
  };
  const service = new UsersService(repository as unknown as UsersRepository);
  return { user, repository, service };
}

describe("UsersService.updateMyAccount — sede", () => {
  it("guarda la sede cuando es activa y del gimnasio de la cuenta", async () => {
    const { user, repository, service } = setup(true);
    await service.updateMyAccount("u1", { sedeId: SEDE });
    expect(repository.isActiveBranchInTenant).toHaveBeenCalledWith(SEDE, "gym-a");
    expect(user.update).toHaveBeenCalledWith({ branchId: SEDE });
  });

  it("rechaza una sede de otro gimnasio o inactiva", async () => {
    const { user, service } = setup(false);
    await expect(service.updateMyAccount("u1", { sedeId: SEDE })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(user.update).not.toHaveBeenCalled();
  });
});

import { Global, Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { STORAGE, StorageFactory } from "./storage.driver";
@Global()
@Module({ controllers: [FilesController], providers: [StorageFactory, { provide: STORAGE, inject: [StorageFactory], useFactory: (f: StorageFactory) => f.create() }, FilesService], exports: [FilesService, STORAGE] })
export class FilesModule {}

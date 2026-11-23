# MCR PRO — Architectural Design & SOLID Principles

MCR PRO is built upon Clean Architecture and SOLID object-oriented principles, ensuring complete decoupling between presentation, application use cases, domain entities, and infrastructure drivers.

## 1. Clean Architecture Layer Breakdown

```
        +-------------------------------------------------------+
        |                  Presentation Layer                   |
        |  - Express REST Controllers                           |
        |  - Socket.IO Real-time Gateways                       |
        |  - Electron Secure IPC Handlers                       |
        +---------------------------+---------------------------+
                                    |
                                    v
        +-------------------------------------------------------+
        |                   Application Layer                   |
        |  - Use Cases & Command Handlers                       |
        |  - Data Transfer Objects (DTOs)                       |
        |  - Zod Request Validators                             |
        +---------------------------+---------------------------+
                                    |
                                    v
        +-------------------------------------------------------+
        |                     Domain Layer                      |
        |  - Entities: Station, User, Studio, Macro, AuditLog   |
        |  - Value Objects: SceneName, DecibelVolume            |
        |  - Abstract Interfaces: IStationRepository,           |
        |                         IUserRepository,              |
        |                         IObsGateway                   |
        +---------------------------+---------------------------+
                                    ^
                                    | (Inversion of Control)
        +---------------------------+---------------------------+
        |                 Infrastructure Layer                  |
        |  - Prisma MySQL Repository Adapter (Online Mode)      |
        |  - SQLite Repository Adapter (Offline Desktop Mode)   |
        |  - ObsClientAdapter (obs-websocket-js v5)             |
        |  - CryptoService (Argon2id + AES-256-GCM)             |
        |  - AgentGateway (Outbound WebSocket Tunnel)           |
        +-------------------------------------------------------+
```

## 2. SOLID Principles Implementation

### Single Responsibility Principle (SRP)
- Each controller is strictly responsible for handling HTTP transport and delegating to services.
- `CryptoService` handles only encryption, hashing, and token signatures.
- `TelemetryCollector` handles only OS and OBS metric retrieval.

### Open/Closed Principle (OCP)
- `IStationRepository` defines persistence contracts.
- Adding new storage backends (e.g. PostgreSQL or MongoDB) requires creating an adapter without altering existing business logic or use cases.

### Liskov Substitution Principle (LSP)
- `SqliteStationRepository` and `PrismaStationRepository` are 100% interchangeable implementations of `IStationRepository`.
- The application core runs identically in Online (MySQL) and Offline (SQLite) without branching inside domain code.

### Interface Segregation Principle (ISP)
- Repository interfaces are focused and minimal.
- Read operations, write operations, and telemetry updates are distinct methods.

### Dependency Inversion Principle (DIP)
- High-level use cases depend strictly on abstract repository interfaces (`IStationRepository`), never directly on Express, Prisma, or SQLite.
- Concrete implementations are injected via `RepositoryFactory`.

class AjapopajaError(Exception):
    """Base error for the application."""
    pass

class EntityNotFoundError(AjapopajaError):
    """Raised when a requested entity is not found."""
    pass

class VersionMismatchError(AjapopajaError):
    """Raised when an OCC conflict occurs."""
    pass

class ValidationError(AjapopajaError):
    """Raised when input data is invalid."""
    pass

//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SyncAssetEditV1 {
  /// Returns a new [SyncAssetEditV1] instance.
  SyncAssetEditV1({
    required this.action,
    required this.assetId,
    required this.id,
    this.parameters = const {},
    required this.sequence,
  });

  /// Asset edit action
  SyncAssetEditV1ActionEnum action;

  /// Asset ID
  String assetId;

  /// Edit ID
  String id;

  /// Edit parameters
  Map<String, Object> parameters;

  /// Edit sequence
  ///
  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int sequence;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SyncAssetEditV1 &&
    other.action == action &&
    other.assetId == assetId &&
    other.id == id &&
    _deepEquality.equals(other.parameters, parameters) &&
    other.sequence == sequence;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (action.hashCode) +
    (assetId.hashCode) +
    (id.hashCode) +
    (parameters.hashCode) +
    (sequence.hashCode);

  @override
  String toString() => 'SyncAssetEditV1[action=$action, assetId=$assetId, id=$id, parameters=$parameters, sequence=$sequence]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'action'] = this.action;
      json[r'assetId'] = this.assetId;
      json[r'id'] = this.id;
      json[r'parameters'] = this.parameters;
      json[r'sequence'] = this.sequence;
    return json;
  }

  /// Returns a new [SyncAssetEditV1] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SyncAssetEditV1? fromJson(dynamic value) {
    upgradeDto(value, "SyncAssetEditV1");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SyncAssetEditV1(
        action: SyncAssetEditV1ActionEnum.fromJson(json[r'action'])!,
        assetId: mapValueOfType<String>(json, r'assetId')!,
        id: mapValueOfType<String>(json, r'id')!,
        parameters: mapCastOfType<String, Object>(json, r'parameters')!,
        sequence: mapValueOfType<int>(json, r'sequence')!,
      );
    }
    return null;
  }

  static List<SyncAssetEditV1> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncAssetEditV1>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncAssetEditV1.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SyncAssetEditV1> mapFromJson(dynamic json) {
    final map = <String, SyncAssetEditV1>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SyncAssetEditV1.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SyncAssetEditV1-objects as value to a dart map
  static Map<String, List<SyncAssetEditV1>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SyncAssetEditV1>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SyncAssetEditV1.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'action',
    'assetId',
    'id',
    'parameters',
    'sequence',
  };
}

/// Asset edit action
class SyncAssetEditV1ActionEnum {
  /// Instantiate a new enum with the provided [value].
  const SyncAssetEditV1ActionEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const crop = SyncAssetEditV1ActionEnum._(r'crop');
  static const rotate = SyncAssetEditV1ActionEnum._(r'rotate');
  static const mirror = SyncAssetEditV1ActionEnum._(r'mirror');

  /// List of all possible values in this [enum][SyncAssetEditV1ActionEnum].
  static const values = <SyncAssetEditV1ActionEnum>[
    crop,
    rotate,
    mirror,
  ];

  static SyncAssetEditV1ActionEnum? fromJson(dynamic value) => SyncAssetEditV1ActionEnumTypeTransformer().decode(value);

  static List<SyncAssetEditV1ActionEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SyncAssetEditV1ActionEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SyncAssetEditV1ActionEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [SyncAssetEditV1ActionEnum] to String,
/// and [decode] dynamic data back to [SyncAssetEditV1ActionEnum].
class SyncAssetEditV1ActionEnumTypeTransformer {
  factory SyncAssetEditV1ActionEnumTypeTransformer() => _instance ??= const SyncAssetEditV1ActionEnumTypeTransformer._();

  const SyncAssetEditV1ActionEnumTypeTransformer._();

  String encode(SyncAssetEditV1ActionEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a SyncAssetEditV1ActionEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  SyncAssetEditV1ActionEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'crop': return SyncAssetEditV1ActionEnum.crop;
        case r'rotate': return SyncAssetEditV1ActionEnum.rotate;
        case r'mirror': return SyncAssetEditV1ActionEnum.mirror;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [SyncAssetEditV1ActionEnumTypeTransformer] instance.
  static SyncAssetEditV1ActionEnumTypeTransformer? _instance;
}


